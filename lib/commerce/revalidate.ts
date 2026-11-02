import { revalidateTag, updateTag } from "next/cache";
import { PRODUCTS_TAG } from "./sanity/client";

// On-demand expiry of the tagged catalog reads (the `next.tags` on every fetch
// in sanity/adapter.ts and site-settings/adapter.ts). Next 16 splits this by
// caller, and `revalidateTag` now REQUIRES a second argument:
//
// - Route Handlers (the Stripe webhook, the Sanity webhook) cannot use
//   `updateTag`: it throws outside a Server Action. They pass `{ expire: 0 }`,
//   the documented immediate-expiry form, so the next request is a blocking
//   miss instead of a stale-while-revalidate hit (`"max"` would keep serving
//   the old, still "available", page while it refreshes).
// - Server Actions use `updateTag`, which expires the tag immediately and is
//   the form made for them.

/** Expires `tag` immediately. Route Handlers only; Server Actions use `updateTag`. */
export function expireTag(tag: string): void {
  revalidateTag(tag, { expire: 0 });
}

// A purge after a sale is a freshness nicety, never a correctness gate:
// checkoutAction reads the catalog uncached, and the ISR window ends on its own
// within a minute. So it must not be able to turn a paid order (the webhook
// would answer 500 and Stripe redeliver) or a recorded manual sale (the admin
// would see an error and retry it) into a failure. The line is fixed on
// purpose: nothing from the error may reach a log.
const NOT_EXPIRED =
  "[commerce] Catalog cache could not be expired; pages refresh on their own within a minute.";

function bestEffort(purge: () => void): void {
  try {
    purge();
  } catch {
    console.error(NOT_EXPIRED);
  }
}

/**
 * A piece just left the shelf: stop serving the cached catalog that still
 * shows it as available. For Route Handlers (the Stripe webhook).
 */
export function expireProductsAfterSale(): void {
  bestEffort(() => expireTag(PRODUCTS_TAG));
}

/** Same purge, from a Server Action (the manual sale). */
export function updateProductsAfterSale(): void {
  bestEffort(() => updateTag(PRODUCTS_TAG));
}
