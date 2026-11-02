import type { ProductSummary } from "./types";

// The shop's two filters, as plain data. Lives outside the client component
// (components/shop/CategoryFilter.tsx) so the matching rules — and the query
// params that carry them — are one unit-tested place with no React in it.

/** Query param carrying the active category slug, e.g. /shop?categoria=anillos. */
export const CATEGORY_PARAM = "categoria";
/** Query param carrying the active collection slug, e.g. /shop?coleccion=dia-de-muertos. */
export const COLLECTION_PARAM = "coleccion";

/** Sentinel for "no filter on this axis" — never a real Sanity slug. */
export const ALL = "__all__";

export interface ShopFilters {
  category: string;
  collection: string;
}

/**
 * Narrows the catalog to the pieces that match BOTH axes. An axis left on
 * `ALL` filters nothing, so with both on `ALL` the original array comes back
 * untouched. A piece matches a collection when it belongs to it — it can belong
 * to several, and to one category.
 */
export function filterProducts(
  products: ProductSummary[],
  { category, collection }: ShopFilters,
): ProductSummary[] {
  if (category === ALL && collection === ALL) return products;

  return products.filter(
    (product) =>
      (category === ALL || product.categorySlug === category) &&
      (collection === ALL || (product.collectionSlugs ?? []).includes(collection)),
  );
}

/**
 * Reads a filter's slug out of the URL, accepting it only if it names a slug
 * the page actually offers. A stale, mistyped or hidden-collection slug falls
 * back to `ALL` instead of landing the shopper on an empty grid that no chip
 * can undo.
 */
export function slugFromParam(
  value: string | null | undefined,
  known: readonly string[],
): string {
  return value && known.includes(value) ? value : ALL;
}
