import "server-only";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import type { SaleItem, SaleSource } from "@/lib/admin/domain/sales";

// THE writer of a sale document's shape, shared by the manual recorder
// (sales.ts) and the Stripe webhook (stripe-sales.ts), as `appendMovement` is
// for the stock ledger. Every field is listed explicitly and nothing is
// spread from the input, so a sale document can ONLY ever hold the fields
// below: in particular there is no place for a customer's email, name,
// address or phone, however much of them the caller happens to have in hand.
// Those stay in Stripe. Optional fields are omitted rather than stored as
// `undefined`, which Firestore rejects.

export interface NewSale {
  source: SaleSource;
  /** When it happened: a Mexico-City midnight (manual) or the payment instant. */
  date: Date;
  items: readonly SaleItem[];
  /** Centavos, all of them. */
  subtotal: number;
  shipping: number;
  total: number;
  costOfGoods: number;
  costPending: boolean;
  /** Stripe sales only: the Checkout Session id (an opaque reference). */
  stripeSessionId?: string;
  /**
   * Stripe sales only: whether the session was made with the LIVE keys. A
   * test-mode sale is stored (so it can be seen and voided) but is left out of
   * every total.
   */
  livemode?: boolean;
  /**
   * Stripe sales only: Stripe's fee WITH the IVA on it, and what it deposits
   * (charged minus fee), integer centavos. Absent while `feePending`.
   */
  stripeFee?: number;
  stripeNet?: number;
  /** Stripe sales only: `true` when the fee could not be read yet. */
  feePending?: boolean;
  /** Manual sales only: the terminal's commission, integer centavos. */
  terminalFee?: number;
  /** Manual sales only. */
  note?: string;
  /** Opaque uid of the admin; a Stripe sale has none. */
  actor?: string;
}

export function buildSaleDocument(sale: NewSale): Record<string, unknown> {
  return {
    source: sale.source,
    status: "active",
    date: Timestamp.fromDate(sale.date),
    items: sale.items.map((item) => ({
      handle: item.handle,
      title: item.title,
      price: item.price,
      ...(item.option ? { option: item.option } : {}),
    })),
    subtotal: sale.subtotal,
    shipping: sale.shipping,
    total: sale.total,
    // The storefront is MXN-only end to end (see lib/commerce/transforms.ts):
    // the unit is a fact of the shop, never read from a payload.
    currency: "MXN",
    costOfGoods: sale.costOfGoods,
    costPending: sale.costPending,
    ...(sale.stripeSessionId ? { stripeSessionId: sale.stripeSessionId } : {}),
    ...(sale.livemode !== undefined ? { livemode: sale.livemode } : {}),
    ...(sale.stripeFee !== undefined ? { stripeFee: sale.stripeFee } : {}),
    ...(sale.stripeNet !== undefined ? { stripeNet: sale.stripeNet } : {}),
    ...(sale.feePending !== undefined ? { feePending: sale.feePending } : {}),
    // A manual sale with no terminal commission (cash) stores no field at all.
    ...(sale.terminalFee ? { terminalFee: sale.terminalFee } : {}),
    ...(sale.note ? { note: sale.note } : {}),
    createdAt: FieldValue.serverTimestamp(),
    ...(sale.actor ? { actor: sale.actor } : {}),
  };
}
