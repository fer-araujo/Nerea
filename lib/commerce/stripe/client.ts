import Stripe from "stripe";

// Server-only Stripe SDK init. The client is constructed LAZILY — only the
// first time it's actually requested — never at module import time. Next.js
// bundles this module as part of the checkout Server Action, and a
// top-level `new Stripe(...)` would throw the instant the module loads if
// `STRIPE_SECRET_KEY` is unset (e.g. `next build` with no real Stripe keys,
// or local dev before the artisan's account exists), which would break the
// build itself. `getStripeClient` fails safe instead: it returns
// `undefined`, and the caller (stripe/checkout.ts) turns that into a normal,
// catchable error — never logging the key, since there is nothing here that
// ever prints `secretKey` or any derivative of it.
let cachedClient: Stripe | undefined;

export function getStripeClient(): Stripe | undefined {
  if (cachedClient) {
    return cachedClient;
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    return undefined;
  }

  cachedClient = new Stripe(secretKey);
  return cachedClient;
}
