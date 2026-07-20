// Domain view models for the commerce data layer. Every `CommerceReadApi`
// adapter (fixtures, Sanity, ...) resolves bilingual source content down to
// these already-localized shapes — nothing outside lib/commerce ever sees a
// raw {es,en} field or a raw CMS `status` string.

export type Locale = "es" | "en";

export type Availability = "available" | "sold";

export interface Money {
  /** Minor units — centavos. Always an integer, never a float. */
  amount: number;
  currency: "MXN";
}

/**
 * A single gallery item — either a still photo or a short video/GIF loop
 * (see sanity/schemaTypes/product.ts's `media` field, which mixes `image`
 * and `file` array members). `kind` is what the UI branches on to pick
 * `next/image` vs `<video>` (components/product/MediaFrame.tsx). `alt` is
 * only ever meaningful for `kind: "image"` — video items autoplay
 * muted/looped, so they carry no accessible-name requirement the way a
 * still image does.
 */
export interface MediaItem {
  kind: "image" | "video";
  url: string;
  alt?: string;
}

/** A product classification. Name + slug only — see sanity/schemaTypes/category.ts. */
export interface Category {
  title: string;
  slug: string;
}

export interface ProductSummary {
  handle: string;
  title: string;
  price: Money;
  availability: Availability;
  /**
   * First gallery item, already resolved for the catalog card's cover —
   * `null` when the piece has no media yet (falls through to
   * `PlaceholderBlock`). Replaces the old single `image: string` field;
   * kept singular (not the full `media` array) because the card only ever
   * renders one cover item, never a gallery.
   */
  cover: MediaItem | null;
  /**
   * Lightweight category join key — NOT the full `Category` object. Lives on
   * the summary (not just on `Product`) solely so the shop page's
   * client-side category filter (components/shop/CategoryFilter.tsx) can
   * match each already-fetched card against the active chip entirely in
   * memory, with no per-filter-click network round-trip. `ProductCard`
   * itself never reads this field.
   */
  categorySlug?: string;
}

export interface Product extends ProductSummary {
  description: string;
  /** Full gallery — image and video/GIF items, in author order. */
  media: MediaItem[];
  /** Full localized category, for display (e.g. the product-detail spec-plate). */
  category?: Category;
}

export interface CommerceReadApi {
  getProducts(locale: Locale): Promise<ProductSummary[]>;
  getProductByHandle(handle: string, locale: Locale): Promise<Product | null>;
  /** Pre-checkout guard: current availability for a set of handles. */
  getAvailability(handles: string[]): Promise<Record<string, Availability>>;
  /** All product categories, localized, for the shop's filter chips. */
  getCategories(locale: Locale): Promise<Category[]>;
}
