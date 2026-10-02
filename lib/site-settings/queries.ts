import { MEDIA_ITEM_PROJECTION } from "@/lib/commerce/sanity/queries";

// `logo` / `heroMedia[0]` reuse the exact same MEDIA_ITEM_PROJECTION as
// product.media (lib/commerce/sanity/queries.ts) so image-vs-file/video
// discrimination never drifts between the two call sites. `heroAlt` follows
// the project's standard bilingual-fallback shape: coalesce to the Spanish
// (default-locale) value when the requested locale's translation is empty.
//
// Matches by `_id` (a fixed literal, "siteSettings" — not user input, so
// this is not string-concatenated GROQ in the injection sense; see
// sanity.config.ts's Studio structure, whose singleton pane always opens
// exactly this id) rather than `_type`, so the query keeps resolving to the
// one true singleton even if Studio's create-new guardrails were ever
// bypassed and a second `siteSettings`-typed document got created.
export const SITE_SETTINGS_QUERY = `
*[_id == "siteSettings"][0] {
  "logo": logo${MEDIA_ITEM_PROJECTION},
  "hero": heroMedia[0]${MEDIA_ITEM_PROJECTION},
  "heroAlt": coalesce(heroAlt[$locale], heroAlt.es)
}
`;

// Flat shipping fee in centavos (same unit as a product's price.amount); an
// unset field projects to 0 = free shipping. A separate, narrow query on
// purpose: it is read only server-side at checkout (see getShippingFee in
// ./adapter.ts) and must not widen the chrome query that runs on every route.
// The option defaults (`ringSizes` / `chainLengths`) are NOT read here — they
// are projected inside the product query (lib/commerce/sanity/queries.ts) so
// a piece's options resolve in a single round trip.
export const SHIPPING_FEE_QUERY = `
coalesce(*[_id == "siteSettings"][0].shippingFee, 0)
`;
