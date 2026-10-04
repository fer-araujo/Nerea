import "server-only";
import { getAdminDb } from "@/lib/admin/firebase/admin";
import { isCentavos } from "@/lib/admin/domain/money";
import {
  costSnapshot,
  itemsSubtotal,
  resolveLivemode,
  type SaleItem,
} from "@/lib/admin/domain/sales";
import { commerce } from "@/lib/commerce";
import {
  formatOptionLabel,
  parseSerializedOptions,
  validateOption,
} from "@/lib/commerce/options";
import { parseHandles } from "@/lib/commerce/stripe/metadata";
import { readPieceCostTotals } from "./pieces";
import { buildSaleDocument } from "./sale-document";
import { COLLECTIONS, isAlreadyExistsError, isDocumentId } from "./shared";
import { fetchStripeFees } from "./stripe-fees";

// Recording a paid Stripe Checkout Session as a sale. Called ONLY by the
// verified webhook (app/api/stripe/webhook/route.ts), after the signature
// check and only for a session whose payment is confirmed (`payment_status`
// "paid"): the route decides that, this function trusts it.
//
// NO CUSTOMER DATA: the session carries the buyer's email, name, shipping
// address and phone, and none of it is read here. The parameter type below
// names the only fields this function can see, and the document is built by
// buildSaleDocument, which has no place for anything else. Customer details
// stay in Stripe, where they are already protected and can be looked up by
// the session id kept on the sale.

/**
 * The slice of a Checkout Session the sale recorder reads. A
 * `Stripe.Checkout.Session` satisfies it structurally; spelling the slice out
 * keeps everything else (customer_details, shipping_details, …) out of reach.
 */
export interface StripeSaleSession {
  id?: string | null;
  /**
   * Whether Stripe made the session with the LIVE keys (`false` = test mode).
   * Part of the signature-verified event; when it is missing the session id
   * (`cs_test_…` / `cs_live_…`) says the same.
   */
  livemode?: boolean | null;
  /** Unix seconds. */
  created?: number | null;
  /** Centavos, before shipping. */
  amount_subtotal?: number | null;
  /** Centavos, what the customer paid. */
  amount_total?: number | null;
  shipping_cost?: { amount_total?: number | null } | null;
  /** `handles` (comma list) and `options` (`handle:size=7` pairs). */
  metadata?: Record<string, string> | null;
}

/**
 * - `recorded`: a new sale was written.
 * - `duplicate`: this session was already recorded (Stripe redelivered the
 *   event, or a retry followed a write that had actually landed).
 * - `unconfigured`: Firebase isn't set up, so nothing can be written.
 * - `skipped`: not a sale this storefront made (no usable session id, or no
 *   pieces in its metadata), so there is nothing to record.
 */
export type StripeSaleOutcome =
  | "recorded"
  | "duplicate"
  | "unconfigured"
  | "skipped";

function asCentavos(value: unknown): number | null {
  return typeof value === "number" && isCentavos(value) ? value : null;
}

/**
 * One line per purchased piece. Title and price come from the catalog (the
 * price is the one the checkout charged: base price plus the catalog's own
 * surcharge for the chosen option, exactly as lib/cart/checkout.ts computes
 * it); the option is what the shopper picked, from `metadata.options`. A
 * piece the catalog no longer knows is kept with its handle as title and
 * price 0 rather than dropped: the money is on the sale's own totals.
 * Rejects if the catalog can't be read, so the webhook can answer 500 and let
 * Stripe retry instead of recording a sale with guessed titles.
 */
async function buildItems(
  handles: readonly string[],
  rawOptions: string | undefined,
): Promise<SaleItem[]> {
  const options = parseSerializedOptions(rawOptions);

  return Promise.all(
    handles.map(async (handle) => {
      const product = await commerce.getProductByHandle(handle, "es");
      const option = options.get(handle);

      let price = 0;
      if (product) {
        const check = option ? validateOption(product.options, option) : null;
        const base = asCentavos(product.price.amount) ?? 0;
        price = base + (check?.valid ? check.extra : 0);
      }

      return {
        handle,
        title: product?.title || handle,
        price,
        ...(option ? { option: formatOptionLabel(option, "es") } : {}),
      };
    }),
  );
}

/**
 * Writes `sales/stripe_<session id>`, idempotently. The document id is derived
 * from the session and written with `create`, which Firestore refuses to
 * overwrite: a redelivered event finds the sale already there (ALREADY_EXISTS)
 * and is reported as `duplicate`, a success, so two deliveries can never make
 * two sales.
 *
 * The totals are the session's own (`amount_subtotal`, `shipping_cost`,
 * `amount_total`): what the customer really paid, not a recomputation. The
 * cost of goods is frozen from `pieces/{handle}` in the same transaction that
 * creates the sale; a piece with no cost recorded marks it `costPending`.
 *
 * The sale also freezes Stripe's own fee and net for the payment, read from the
 * session's balance transaction BEFORE the create (see stripe-fees.ts). When
 * Stripe cannot give them yet (a balance transaction can lag the payment, or
 * the call fails) the sale is STILL recorded, with `feePending: true`, and the
 * panel offers "Actualizar comisión": a missing fee must never cost a paid sale
 * or turn into a 500 that makes Stripe retry for nothing.
 *
 * It stores `livemode`, so a test-mode purchase, which lands in the same
 * Firestore as production when testing locally, is kept apart from real sales.
 *
 * Returns `unconfigured` before touching anything when Firebase isn't set up.
 * Any real failure (Firestore, or the catalog read it needs) REJECTS, and the
 * caller must treat that as "answer 500 so Stripe retries".
 */
export async function recordStripeSale(
  session: StripeSaleSession,
): Promise<StripeSaleOutcome> {
  const db = getAdminDb();
  if (!db) {
    return "unconfigured";
  }

  const sessionId = session.id;
  const saleId = `stripe_${sessionId ?? ""}`;
  const handles = [...new Set(parseHandles(session.metadata?.handles))];
  if (!sessionId || !isDocumentId(saleId) || handles.length === 0) {
    return "skipped";
  }

  // Independent reads, so they run together. `fetchStripeFees` never rejects:
  // it answers `null` for a fee that is not available.
  const [items, fees] = await Promise.all([
    buildItems(handles, session.metadata?.options),
    fetchStripeFees(sessionId),
  ]);
  const livemode = resolveLivemode(session.livemode, sessionId);

  const subtotal = asCentavos(session.amount_subtotal) ?? itemsSubtotal(items);
  const shipping = asCentavos(session.shipping_cost?.amount_total) ?? 0;
  const total = asCentavos(session.amount_total) ?? subtotal + shipping;
  const date =
    typeof session.created === "number" && session.created > 0
      ? new Date(session.created * 1000)
      : new Date();

  try {
    await db.runTransaction(async (tx) => {
      // Transactions need every read before the first write.
      const { costOfGoods, costPending } = costSnapshot(
        handles,
        await readPieceCostTotals(db, tx, handles),
      );

      tx.create(
        db.collection(COLLECTIONS.sales).doc(saleId),
        buildSaleDocument({
          source: "stripe",
          date,
          items,
          subtotal,
          shipping,
          total,
          costOfGoods,
          costPending,
          stripeSessionId: sessionId,
          livemode,
          ...(fees
            ? { stripeFee: fees.fee, stripeNet: fees.net, feePending: false }
            : { feePending: true }),
        }),
      );
    });
  } catch (error) {
    if (isAlreadyExistsError(error)) {
      return "duplicate";
    }
    throw error;
  }

  return "recorded";
}
