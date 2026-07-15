import { createClient } from "@sanity/client";
import { apiVersion, dataset, projectId } from "@/sanity/env";

export const PRODUCTS_TAG = "products";
export const PRODUCTS_REVALIDATE_SECONDS = 60;

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
