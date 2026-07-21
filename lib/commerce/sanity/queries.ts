// GROQ documents for the product catalog. `$locale` selects the localized
// field on each bilingual {es,en} object; `coalesce(...)` falls back to the
// Spanish (default-locale) value when the requested locale's field is
// missing, matching the storefront's bilingual-fallback requirement — these
// queries return already-localized strings, so nothing downstream needs to
// know about the {es,en} shape. `price` is projected explicitly (not as the
// bare `price` object) so the response shape always matches the domain
// `Money` fields regardless of any Sanity-internal object metadata.
//
// `media` array members are either `image` or `file` documents (see
// sanity/schemaTypes/product.ts) — `select(_type == "image" => "image",
// "video")` discriminates which one each item is so lib/commerce/sanity/
// adapter.ts can resolve it to a domain `MediaItem` without knowing about
// Sanity's internal `_type` values.

// Exported so lib/site-settings/queries.ts can project siteSettings' `logo`/
// `heroMedia[0]` through the exact same image-vs-file/video discrimination —
// one definition, never two GROQ snippets that could drift apart.
export const MEDIA_ITEM_PROJECTION = `{
  "kind": select(_type == "image" => "image", "video"),
  "url": asset->url
}`;

export const PRODUCTS_LIST_QUERY = `
*[_type == "product"] | order(_createdAt desc) {
  "handle": slug.current,
  "title": coalesce(title[$locale], title.es),
  "price": { "amount": price.amount, "currency": price.currency },
  status,
  "cover": media[0]${MEDIA_ITEM_PROJECTION},
  "categorySlug": category->slug.current
}
`;

export const PRODUCT_BY_HANDLE_QUERY = `
*[_type == "product" && slug.current == $handle][0] {
  "handle": slug.current,
  "title": coalesce(title[$locale], title.es),
  "description": coalesce(description[$locale], description.es),
  "price": { "amount": price.amount, "currency": price.currency },
  status,
  "media": media[]${MEDIA_ITEM_PROJECTION},
  "category": category->{
    "title": coalesce(title[$locale], title.es),
    "slug": slug.current
  }
}
`;

export const AVAILABILITY_BY_HANDLES_QUERY = `
*[_type == "product" && slug.current in $handles] {
  "handle": slug.current,
  status
}
`;

export const CATEGORIES_QUERY = `
*[_type == "category"] | order(title.es asc) {
  "title": coalesce(title[$locale], title.es),
  "slug": slug.current
}
`;
