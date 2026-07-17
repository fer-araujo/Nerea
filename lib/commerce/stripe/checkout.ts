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
  { successUrl, cancelUrl }: CreateCheckoutSessionOptions,
): Promise<string> {
  const stripe = getStripeClient();
  if (!stripe) {
    throw new Error("Stripe is not configured.");
  }

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
  });

  if (!session.url) {
    throw new Error("Stripe did not return a checkout session URL.");
  }

  return session.url;
}
