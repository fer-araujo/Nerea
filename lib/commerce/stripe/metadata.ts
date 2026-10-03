// Reading back what `createCheckoutSession` (./checkout.ts) attached to a
// Checkout Session. Kept apart from the webhook's route file because a Next.js
// route module may only export its handlers, and from checkout.ts because this
// side runs inside the verified webhook while that one talks to the Stripe API.

/**
 * `metadata.handles`: the purchased pieces, comma-joined. A missing value is
 * "no pieces" (a session this storefront did not create), never an error.
 */
export function parseHandles(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((handle) => handle.trim())
    .filter(Boolean);
}
