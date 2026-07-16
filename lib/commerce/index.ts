import type { CommerceReadApi } from "./types";
import { fixturesApi } from "./fixtures";
import { sanityApi } from "./sanity/adapter";

// The one seam the rest of the app depends on: everywhere outside
// lib/commerce imports `{ commerce }` from here, never `fixtures` or
// `sanity/adapter` directly, so swapping the backend never touches call
// sites. Defaults to fixtures so the app runs before the Sanity project has
// any products (or before COMMERCE_SOURCE is set at all).
const source = process.env.COMMERCE_SOURCE ?? "fixtures";

export const commerce: CommerceReadApi =
  source === "sanity" ? sanityApi : fixturesApi;
