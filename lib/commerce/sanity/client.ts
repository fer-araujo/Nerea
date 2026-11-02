import { createClient } from "@sanity/client";
import { apiVersion, dataset, projectId } from "@/sanity/env";

export const PRODUCTS_TAG = "products";
export const PRODUCTS_REVALIDATE_SECONDS = 60;
export const CATEGORIES_TAG = "categories";
// Same cadence as products: the artisan manages both from the same Studio
// session, so there is no reason for one to go stale relative to the other.
export const CATEGORIES_REVALIDATE_SECONDS = 60;
// Collections are edited in the same Studio session as pieces and categories,
// so they follow the same cadence. A collection that reaches its closing date
// (`endsAt`) disappears on its own at the next refresh, with no edit and so no
// webhook: this window is what bounds how long it can linger.
export const COLLECTIONS_TAG = "collections";
export const COLLECTIONS_REVALIDATE_SECONDS = 60;

// Server-only by convention: this module is only ever imported from Server
// Components / Server Actions (lib/commerce's adapters), never from a
// "use client" file. useCdn is false because freshness here is governed by
// Next's own fetch cache (`next: { revalidate, tags }` on every query in
// adapter.ts), not Sanity's independent CDN cache — running both would just
// create two disagreeing caches.
export const sanityClient = createClient({
  projectId,
  dataset,
  apiVersion,
  useCdn: false,
});
