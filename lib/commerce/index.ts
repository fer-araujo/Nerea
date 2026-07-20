import type { CommerceReadApi } from "./types";
import { fixturesApi } from "./fixtures";
import { sanityApi } from "./sanity/adapter";

// The one seam the rest of the app depends on: everywhere outside
// lib/commerce imports `{ commerce }` from here, never `fixtures` or
// `sanity/adapter` directly, so swapping the backend never touches call
// sites. Defaults to the live Sanity catalog now that the project is
// provisioned (see sanity/env.ts) — every read path (shop, product detail,
// sitemap, generateStaticParams) already fails safe to an empty list/null on
// a fetch error, so this is safe even against a zero-product dataset.
// `COMMERCE_SOURCE=fixtures` stays available as a credential-free dev/test
// override (used by, e.g., tests/shop-catalog.test.tsx via a direct mock,
// and by local development when live data isn't needed).
const source = process.env.COMMERCE_SOURCE ?? "sanity";

export const commerce: CommerceReadApi =
  source === "sanity" ? sanityApi : fixturesApi;
