import type Stripe from "stripe";
import { getStripeClient } from "@/lib/commerce/stripe/client";
import { markProductsSold } from "@/lib/commerce/sanity/mark-sold";

// Raw-body signature verification (constructEvent) needs Node's crypto —
// this route must never run on the Edge runtime.
export const runtime = "nodejs";

function parseHandles(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((handle) => handle.trim())
    .filter(Boolean);
}

// Stripe webhook endpoint: on a verified `checkout.session.completed`
// event, marks the purchased piece(s) sold in Sanity so a one-of-one piece
// can never be sold twice.
//
// Signature verification below is the ONLY thing standing between this
// route and a forged "mark everything sold" POST — it is mandatory and
// fails closed: a missing/invalid signature or an unset webhook secret
// returns 400 and nothing is processed. This handler never throws
// uncaught and never logs the secret, the raw body, or any session detail.
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

  if (event.type === "checkout.session.completed") {
    try {
      const session = event.data.object as Stripe.Checkout.Session;
      const handles = parseHandles(session.metadata?.handles);
      await markProductsSold(handles);
    } catch {
      // markProductsSold already fails safe per handle; this is a final
      // safety net so a genuinely unexpected error here can never escape
      // as an uncaught failure — this route's hard contract is to never
      // throw once the event is verified.
    }
  }

  // Every other verified event type is an intentional no-op: 200 tells
  // Stripe not to retry an event this endpoint has nothing to do with.
  return Response.json({ received: true }, { status: 200 });
}
