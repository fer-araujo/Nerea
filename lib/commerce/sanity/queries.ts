// GROQ documents for the product catalog. `$locale` selects the localized
// field on each bilingual {es,en} object; `coalesce(...)` falls back to the
// Spanish (default-locale) value when the requested locale's field is
// missing, matching the storefront's bilingual-fallback requirement — these
// queries return already-localized strings, so nothing downstream needs to
// know about the {es,en} shape. `price` is projected explicitly (not as the
// bare `price` object) so the response shape always matches the domain
// `Money` fields regardless of any Sanity-internal object metadata.

export const PRODUCTS_LIST_QUERY = `
*[_type == "product"] | order(_createdAt desc) {
  "handle": slug.current,
  "title": coalesce(title[$locale], title.es),
  "price": { "amount": price.amount, "currency": price.currency },
  status,
  "image": images[0].asset->url
}
`;

export const PRODUCT_BY_HANDLE_QUERY = `
*[_type == "product" && slug.current == $handle][0] {
  "handle": slug.current,
  "title": coalesce(title[$locale], title.es),
  "description": coalesce(description[$locale], description.es),
  "price": { "amount": price.amount, "currency": price.currency },
  status,
  "images": images[].asset->url
}
`;

export const AVAILABILITY_BY_HANDLES_QUERY = `
*[_type == "product" && slug.current in $handles] {
  "handle": slug.current,
  status
}
`;
