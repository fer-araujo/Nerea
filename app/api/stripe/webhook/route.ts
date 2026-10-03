import type Stripe from "stripe";
import { recordStripeSale } from "@/lib/admin/data/stripe-sales";
import { getStripeClient } from "@/lib/commerce/stripe/client";
import { markProductsSold } from "@/lib/commerce/sanity/mark-sold";
import { parseHandles } from "@/lib/commerce/stripe/metadata";

// Raw-body signature verification (constructEvent) needs Node's crypto —
// this route must never run on the Edge runtime.
export const runtime = "nodejs";

// What goes in the 500 body (Stripe shows it next to the failed delivery in
// its Dashboard) and, with the same wording, the one log line per failure.
// Fixed strings on purpose: nothing from the session, the error or the
// database may end up in a log or a response.
const NOT_MARKED_SOLD = "pieces not marked sold";
const NOT_RECORDED = "sale not recorded";
const LEDGER_NOT_CONFIGURED = "sale ledger not configured";

// Takes a PAID session's pieces off the shelf and records the sale. Returns
// what went wrong, if anything — empty means fully done. BOTH steps are
// attempted whatever the other did: the money has arrived, and the ledger must
// not wait for Sanity's write path (nor the shelf for Firestore).
//
// Every failure is reported rather than absorbed, because the caller answers
// 500 for any of them and Stripe redelivers the event. A redelivery is safe:
// marking sold is idempotent and the sale is written with `create` under an id
// derived from the session, so a step that had actually landed is a harmless
// no-op the second time, never a second sale.
async function fulfilPaidSession(
  session: Stripe.Checkout.Session,
): Promise<string[]> {
  const failures: string[] = [];

  // `markProductsSold` never throws: a piece it could not mark comes back in
  // `failed` (a missing token fails them all). A product that no longer exists
  // comes back in `missing`, which is not a failure.
  const { failed } = await markProductsSold(
    parseHandles(session.metadata?.handles),
  );
  if (failed.length > 0) {
    console.error(
      "[stripe] Pieces could not be marked sold; answering 500 so Stripe retries.",
    );
    failures.push(NOT_MARKED_SOLD);
  }

  try {
    // `unconfigured` is NOT shrugged off with a 200: that would drop a real,
    // paid sale without anyone noticing a broken deployment. A 500 makes
    // Stripe retry and show the failure, so the misconfiguration is seen and,
    // once fixed, the retry records the sale.
    const outcome = await recordStripeSale(session);
    if (outcome === "unconfigured") {
      console.error(
        "[stripe] Sale not recorded: Firestore is not configured; answering 500 so Stripe retries.",
      );
      failures.push(LEDGER_NOT_CONFIGURED);
    }
  } catch {
    // The error is deliberately not logged: it could echo document paths or
    // session details.
    console.error(
      "[stripe] Sale could not be recorded; answering 500 so Stripe retries.",
    );
    failures.push(NOT_RECORDED);
  }

  return failures;
}

// Stripe webhook endpoint. A piece is sold, and its sale recorded, ONLY once
// its payment is confirmed ("pay before sell"):
// - `checkout.session.completed` with `payment_status` "paid" (a card payment
//   confirmed at checkout, the only kind the storefront offers: see
//   `payment_method_types` in lib/commerce/stripe/checkout.ts);
// - `checkout.session.async_payment_succeeded` (a delayed method finally
//   paid), handled for completeness even though no such method is offered.
// An UNPAID `completed` (a voucher issued but not yet paid) and
// `checkout.session.async_payment_failed` are deliberate no-ops: nothing was
// paid, so no piece is taken off the shelf and no sale is made.
//
// Signature verification below is the ONLY thing standing between this
// route and a forged "mark everything sold" POST — it is mandatory and
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
