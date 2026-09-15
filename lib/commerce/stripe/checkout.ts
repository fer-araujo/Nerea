import { getStripeClient } from "./client";

export interface CheckoutLineInput {
  /** Displayed as the Stripe line item's product name. */
  name: string;
  /** Minor units (centavos) — matches the domain `Money.amount` directly. */
  amount: number;
  quantity: number;
}

export interface CreateCheckoutSessionOptions {
  successUrl: string;
  cancelUrl: string;
  /**
   * Purchased product handles, attached to the created Checkout Session as
   * `metadata.handles` (comma-joined) so the Stripe webhook
   * (app/api/stripe/webhook/route.ts) can map a completed payment back to
   * the Sanity product documents to mark sold — Stripe never otherwise
   * tells a webhook which of our domain products a session paid for.
   * Optional and purely additive: omitting it (as
   * tests/stripe-checkout.test.ts's direct unit tests do) leaves the
   * created session's payload byte-for-byte identical to before this field
   * existed, metadata included.
   */
  handles?: string[];
}

// Builds Stripe line items from the domain cart lines (name / amount-in-
// centavos / quantity) and creates a one-shot Checkout Session. The
// storefront is MXN-only end to end (lib/commerce/transforms.ts `toMoney`),
// so currency is always the literal "mxn" here — never derived from caller
// input. Throws on any Stripe SDK/network failure or missing configuration;
// the caller (lib/cart/checkout.ts) is responsible for catching this and
// returning a retryable result instead of letting it escape uncaught.
export async function createCheckoutSession(
  lines: CheckoutLineInput[],
  { successUrl, cancelUrl, handles }: CreateCheckoutSessionOptions,
): Promise<string> {
  const stripe = getStripeClient();
  if (!stripe) {
    throw new Error("Stripe is not configured.");
  }

  // Stripe caps a metadata value at 500 chars. A one-of-one cart is a
  // handful of short slugs at most, so this is a defensive bound, not an
  // expected truncation path — and even a truncated/unmatched handle is
  // safe downstream (lib/commerce/sanity/mark-sold.ts skips handles with no
  // matching document instead of throwing).
  const metadata =
    handles && handles.length > 0
      ? { handles: handles.join(",").slice(0, 500) }
      : undefined;

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: lines.map((line) => ({
      price_data: {
        currency: "mxn",
        product_data: { name: line.name },
        unit_amount: line.amount,
      },
      quantity: line.quantity,
    })),
    success_url: successUrl,
    cancel_url: cancelUrl,
    ...(metadata ? { metadata } : {}),
  });

  if (!session.url) {
    throw new Error("Stripe did not return a checkout session URL.");
  }

  return session.url;
}
