import type Stripe from "stripe";
import {
  readStripeSaleStock,
  recordStripeSale,
  saveStripeSaleStock,
  type StripeSaleOutcome,
} from "@/lib/admin/data/stripe-sales";
import { getStripeClient } from "@/lib/commerce/stripe/client";
import { expireProductsAfterSale } from "@/lib/commerce/revalidate";
import { decrementStock } from "@/lib/commerce/sanity/stock";
import {
  quantitiesByHandle,
  readSessionItems,
} from "@/lib/commerce/stripe/metadata";

// Raw-body signature verification (constructEvent) needs Node's crypto —
// this route must never run on the Edge runtime.
export const runtime = "nodejs";

// What goes in the 500 body (Stripe shows it next to the failed delivery in
// its Dashboard) and, with the same wording, the one log line per failure.
// Fixed strings on purpose: nothing from the session, the error or the
// database may end up in a log or a response.
const STOCK_NOT_UPDATED = "stock not updated";
const STOCK_NOT_SAVED = "stock progress not saved";
const NOT_RECORDED = "sale not recorded";
const LEDGER_NOT_CONFIGURED = "sale ledger not configured";

// Takes the units of a PAID session off the shop's stock, once. Stripe
// redelivers an event until it gets a 200 (and a Dashboard resend can deliver
// it again long after), so "once" is enforced where it cannot be bypassed:
// `decrementStock` creates a marker document per (session, piece) in the SAME
// Sanity transaction as the decrement, and a second attempt is refused by
// Sanity itself. That makes every call here safe to repeat, whatever failed in
// between, and whatever the delivery order.
//
// The sale's `stockApplied` flag is only a shortcut on top of that: a sale
// already marked skips the Sanity round trips. Reading it is best-effort, and
// a sale without the flag (one recorded before it existed, or whose flag could
// not be saved) simply asks again and finds its markers.
//
// Returns what went wrong, if anything — empty means fully done.
async function applyStock(
  session: Stripe.Checkout.Session,
  outcome: "recorded" | "duplicate",
): Promise<string[]> {
  if (outcome === "duplicate") {
    try {
      if ((await readStripeSaleStock(session.id))?.applied) {
        return [];
      }
    } catch {
      // Not knowing is fine: the markers make asking again harmless.
    }
  }

  // Per handle, all of its lines (sizes) added up: the stock is per design.
  const pending = [...quantitiesByHandle(readSessionItems(session.metadata))].map(
    ([handle, qty]) => ({ handle, qty }),
  );

  // `decrementStock` never throws: a piece it could not update comes back in
  // `failed` (a missing token fails them all). A product that no longer exists
  // comes back in `missing`, and one whose units an earlier attempt already took
  // off in `decremented`: neither is a failure.
  const result = await decrementStock(pending, session.id);

  // Whatever was lowered is off the shelf now, even when a sibling piece
  // failed: expire the cached catalog so the shop and the product pages stop
  // offering it. Immediately, not stale-while-revalidate, and best-effort (see
  // lib/commerce/revalidate.ts): it can never fail the delivery.
  if (result.decremented.length > 0) {
    expireProductsAfterSale();
  }

  const failures: string[] = [];
  if (result.failed.length > 0) {
    console.error(
      "[stripe] Stock could not be updated; answering 500 so Stripe retries.",
    );
    failures.push(STOCK_NOT_UPDATED);
  }

  try {
    await saveStripeSaleStock(session.id, {
      applied: result.failed.length === 0,
      oversold: result.oversold.length > 0,
    });
  } catch {
    // The units are off (the markers say so) but the sale does not, so the
    // oversold flag may be lost. Answering 500 keeps it visible in Stripe,
    // where it is seen and fixed; the error is deliberately not logged
    // (document paths).
    console.error(
      "[stripe] Stock progress could not be saved; answering 500 so Stripe retries.",
    );
    failures.push(STOCK_NOT_SAVED);
  }

  return failures;
}

// Records the sale of a PAID session and takes its units off the stock.
// Returns what went wrong, if anything — empty means fully done.
//
// The sale goes FIRST, so a paid order is never in the stock but missing from
// the books. Every failure is reported rather than absorbed, because the caller
// answers 500 for any of them and Stripe redelivers the event. A redelivery is
// safe: the sale is written with `create` under an id derived from the session,
// so one that had actually landed is a harmless no-op the second time, never a
// second sale, and the stock is taken off once per (session, piece) however
// many times it is asked (see applyStock).
async function fulfilPaidSession(
  session: Stripe.Checkout.Session,
): Promise<string[]> {
  let outcome: StripeSaleOutcome;
  try {
    outcome = await recordStripeSale(session);
  } catch {
    // The error is deliberately not logged: it could echo document paths or
    // session details.
    console.error(
      "[stripe] Sale could not be recorded; answering 500 so Stripe retries.",
    );
    return [NOT_RECORDED];
  }

  // `unconfigured` is NOT shrugged off with a 200: that would drop a real,
  // paid sale without anyone noticing a broken deployment. A 500 makes Stripe
  // retry and show the failure, so the misconfiguration is seen and, once
  // fixed, the retry records the sale (and only then takes the stock off).
  if (outcome === "unconfigured") {
    console.error(
      "[stripe] Sale not recorded: Firestore is not configured; answering 500 so Stripe retries.",
    );
    return [LEDGER_NOT_CONFIGURED];
  }

  // Not a sale this storefront made (no pieces in its metadata): nothing was
  // sold, so there is nothing to take off.
  if (outcome === "skipped") {
    return [];
  }

  return applyStock(session, outcome);
}

// Stripe webhook endpoint. A sale is recorded, and its units taken off the
// stock, ONLY once its payment is confirmed ("pay before sell"):
// - `checkout.session.completed` with `payment_status` "paid" (a card payment
//   confirmed at checkout, the only kind the storefront offers: see
//   `payment_method_types` in lib/commerce/stripe/checkout.ts);
// - `checkout.session.async_payment_succeeded` (a delayed method finally
//   paid), handled for completeness even though no such method is offered.
// An UNPAID `completed` (a voucher issued but not yet paid) and
// `checkout.session.async_payment_failed` are deliberate no-ops: nothing was
// paid, so no unit is taken off the shelf and no sale is made.
//
// Signature verification below is the ONLY thing standing between this
// route and a forged "empty the shop" POST — it is mandatory and
// fails closed: a missing/invalid signature or an unset webhook secret
// returns 400 and nothing is processed. This handler never logs the secret,
// the raw body, or any session detail (the log lines above are fixed strings).
//
// Status codes once the event is verified: 500 when a paid session could not
// be fully processed (see fulfilPaidSession), so Stripe retries; 200 for
// everything else, including every event this endpoint has nothing to do with.
export async function POST(req: Request): Promise<Response> {
  const stripe = getStripeClient();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = req.headers.get("stripe-signature");

  if (!stripe || !secret || !signature) {
    return Response.json({ error: "invalid signature" }, { status: 400 });
  }

  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, secret);
  } catch {
    return Response.json({ error: "invalid signature" }, { status: 400 });
  }

  if (
    event.type === "checkout.session.completed" ||
    event.type === "checkout.session.async_payment_succeeded"
  ) {
    const session = event.data.object;

    // Checked on BOTH event types: for `async_payment_succeeded` it is always
    // "paid", so this costs nothing there, and it keeps one rule — nothing is
    // sold on anything but a confirmed payment.
    if (session.payment_status === "paid") {
      const failures = await fulfilPaidSession(session);
      if (failures.length > 0) {
        return Response.json({ error: failures.join("; ") }, { status: 500 });
      }
    }
  }

  // Every other verified event type — async_payment_failed included — is an
  // intentional no-op: 200 tells Stripe not to retry an event this endpoint
  // has nothing to do with.
  return Response.json({ received: true }, { status: 200 });
}
