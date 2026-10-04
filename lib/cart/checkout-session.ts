// The handoff between the Stripe Checkout redirect and the success page
// (app/[locale]/checkout/success/page.tsx). Stripe sends the shopper back to
// `success_url`, and that URL carries the Checkout Session id, so the page can
// tell a real return from a hand-typed visit.
//
// A plain module on purpose (no "use server", no "use client"): the checkout
// Server Action builds the URL and a client island reads it back, and a file
// with a directive cannot hand plain values across that boundary.

/** The query parameter that carries the Checkout Session id. */
export const SESSION_ID_PARAM = "session_id";

/**
 * Stripe's own template variable: Stripe replaces this literal text with the
 * real session id when it redirects the shopper. It has to reach Stripe
 * UN-encoded (`%7BCHECKOUT_SESSION_ID%7D` is not substituted), so the success
 * URL is built by plain concatenation, never through URLSearchParams or
 * `new URL`.
 */
export const SESSION_ID_PLACEHOLDER = "{CHECKOUT_SESSION_ID}";

// `cs_test_…` / `cs_live_…` plus a random tail: letters, digits and underscores
// only, and bounded, so an absurd value in the query string is never trusted.
const SESSION_ID_PATTERN = /^cs_[A-Za-z0-9_]{1,200}$/;

/** Whether `value` looks like a Stripe Checkout Session id. */
export function isCheckoutSessionId(value: unknown): value is string {
  return typeof value === "string" && SESSION_ID_PATTERN.test(value);
}

/** `https://…/checkout/success` -> `https://…/checkout/success?session_id={CHECKOUT_SESSION_ID}` */
export function withSessionIdPlaceholder(successUrl: string): string {
  const separator = successUrl.includes("?") ? "&" : "?";
  return `${successUrl}${separator}${SESSION_ID_PARAM}=${SESSION_ID_PLACEHOLDER}`;
}
