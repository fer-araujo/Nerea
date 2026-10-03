import { serializeOption } from "../options";
import type { Locale, SelectedOption } from "../types";
import { getStripeClient } from "./client";

// SECURITY: every field here MUST be resolved server-side from
// `commerce.getProductByHandle` (see lib/cart/checkout.ts's `checkoutAction`,
// the only caller). This module has no way to verify where a value came
// from — the trust boundary is enforced procedurally by the caller, not by
// this type. Never build this from a client-supplied cart line directly.
export interface CheckoutLineInput {
  /** Displayed as the Stripe line item's product name. */
  name: string;
  /** Minor units (centavos) — matches the domain `Money.amount` directly. */
  amount: number;
  quantity: number;
}

// Same trust rule as `CheckoutLineInput`: `option` must be the catalog-
// validated copy returned by `validateOption`, never the raw cart value.
export interface CheckoutOptionInput {
  handle: string;
  option: SelectedOption;
}

export interface CreateCheckoutSessionOptions {
  successUrl: string;
  cancelUrl: string;
  /**
   * Flat shipping fee in centavos; 0 = free shipping. Read server-side from
   * the site settings by the caller (SECURITY: never from the client).
   * Required, not defaulted: forgetting it must be a type error, not a
   * silently free shipping rate.
   */
  shippingFee: number;
  /** Locale for the shipping rate's display name on Stripe's hosted page. */
  locale: Locale;
  /**
   * Purchased product handles, attached to the created Checkout Session as
   * `metadata.handles` (comma-joined) so the Stripe webhook
   * (app/api/stripe/webhook/route.ts) can map a completed payment back to
   * the Sanity product documents to mark sold — Stripe never otherwise
   * tells a webhook which of our domain products a session paid for. Never
   * truncated: a comma-joined list over Stripe's 500-char metadata cap makes
   * `createCheckoutSession` throw rather than risk a paid piece not being
   * marked sold.
   * Optional and purely additive: omitting both `handles` and `options` (as
   * the direct unit tests in tests/stripe-checkout.test.ts do) leaves the
   * session WITHOUT a `metadata` key at all, exactly as before these fields
   * existed.
   */
  handles?: string[];
  /**
   * The chosen ring size / chain length per purchased piece, attached as
   * `metadata.options` — comma-joined `handle:size=7` / `handle:chain=45`
   * pairs (see `serializeOption`) — so the jeweler sees what to size or cut
   * right in her Stripe Dashboard. Pieces without an option are simply absent.
   * Cut to Stripe's 500-char cap if ever longer: unlike `handles`, losing the
   * tail is harmless because the option is also in the line item's name.
   */
  options?: CheckoutOptionInput[];
}

// Stripe caps a metadata value at 500 chars. A one-of-one cart is a handful of
// short slugs at most, so hitting this is not an expected path. The two values
// are NOT equally safe to cut, though:
// - `handles` must never be truncated. The webhook marks sold ONLY the handles
//   it finds in `metadata.handles`, so a silently dropped handle would leave a
//   PAID one-of-one piece purchasable again (a double sale). It fails closed
//   instead: createCheckoutSession throws, and the caller collapses that into
//   a retryable result.
// - `options` is informational (what to size or cut) and the chosen option is
//   also part of the line item's name, so cutting it loses nothing critical.
const METADATA_VALUE_MAX = 500;

// Shown on Stripe's hosted checkout page, so it is localized here: this module
// runs on the server where next-intl's client messages are not at hand.
const SHIPPING_RATE_NAMES: Record<Locale, { paid: string; free: string }> = {
  es: { paid: "Envío", free: "Envío gratis" },
  en: { paid: "Shipping", free: "Free shipping" },
};

// Builds Stripe line items from the domain cart lines (name / amount-in-
// centavos / quantity) and creates a one-shot Checkout Session. The
// storefront is MXN-only end to end (lib/commerce/transforms.ts `toMoney`),
// so currency is always the literal "mxn" here — never derived from caller
// input. The session also collects what the jeweler needs to ship the piece:
// a Mexican shipping address and a phone number, priced by one flat rate.
// Throws on any Stripe SDK/network failure, missing configuration, an invalid
// shipping fee or a handle list too long for Stripe's metadata; the caller
// (lib/cart/checkout.ts) is responsible for catching this and returning a
// retryable result instead of letting it escape uncaught.
export async function createCheckoutSession(
  lines: CheckoutLineInput[],
  {
    successUrl,
    cancelUrl,
    shippingFee,
    locale,
    handles,
    options,
  }: CreateCheckoutSessionOptions,
): Promise<string> {
  const stripe = getStripeClient();
  if (!stripe) {
    throw new Error("Stripe is not configured.");
  }

  // Fail closed: a negative/fractional/NaN fee must never turn into a
  // surprise shipping rate (or a Stripe API error with a confusing message).
  if (!Number.isInteger(shippingFee) || shippingFee < 0) {
    throw new Error("Invalid shipping fee.");
  }

  const metadata: Record<string, string> = {};
  if (handles && handles.length > 0) {
    const joinedHandles = handles.join(",");
    // Thrown before any session exists, so nothing is created or charged.
    if (joinedHandles.length > METADATA_VALUE_MAX) {
      throw new Error("Purchased handles exceed Stripe's metadata limit.");
    }
    metadata.handles = joinedHandles;
  }
  if (options && options.length > 0) {
    metadata.options = options
      .map(({ handle, option }) => serializeOption(handle, option))
      .join(",")
      .slice(0, METADATA_VALUE_MAX);
  }

  const rateNames = SHIPPING_RATE_NAMES[locale];

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    // Card only, enforced HERE and not left to the Stripe Dashboard's payment-
    // method settings (which anyone with Dashboard access could widen). Pieces
    // are one-of-one: one "bought" with a delayed method (an OXXO voucher, a
    // bank transfer) would sit in limbo, and the webhook sells a piece only
    // once payment is confirmed (app/api/stripe/webhook/route.ts) — so it would
    // stay buyable by everyone else, or be held for a voucher nobody pays.
    payment_method_types: ["card"],
    line_items: lines.map((line) => ({
      price_data: {
        currency: "mxn",
        product_data: { name: line.name },
        unit_amount: line.amount,
      },
      quantity: line.quantity,
    })),
    // Mexico only for now: one flat rate, and the shop ships nowhere else.
    shipping_address_collection: { allowed_countries: ["MX"] },
    phone_number_collection: { enabled: true },
    shipping_options: [
      {
        shipping_rate_data: {
          type: "fixed_amount",
          fixed_amount: { amount: shippingFee, currency: "mxn" },
          display_name: shippingFee === 0 ? rateNames.free : rateNames.paid,
        },
      },
    ],
    success_url: successUrl,
    cancel_url: cancelUrl,
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
  });

  if (!session.url) {
    throw new Error("Stripe did not return a checkout session URL.");
  }

  return session.url;
}
