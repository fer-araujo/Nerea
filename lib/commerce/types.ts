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

/**
 * One selectable chain length. `extra` is the surcharge in minor units
 * (centavos, a non-negative integer) — the same unit as `Money.amount` — and
 * 0 means the length costs nothing extra.
 */
export interface ChainLengthOption {
  lengthCm: number;
  extra: number;
}

/**
 * What a shopper must choose before a piece can be bought, already resolved
 * to concrete values. The KIND comes from the piece, or from its category when
 * the piece says "inherit"; the VALUES from the per-piece override ->
 * "Ajustes del sitio" defaults -> code defaults (see lib/commerce/options.ts).
 * `none` means the piece is bought as-is. Lives on the detail `Product` only: the listing summary never
 * renders a picker, so it never carries (or serializes) these lists.
 */
export type ProductOptions =
  | { kind: "none" }
  | { kind: "ringSize"; values: string[] }
  | { kind: "chainLength"; values: ChainLengthOption[] };

/**
 * A shopper's pick, as carried by a cart line. It is CLIENT-SUPPLIED once it
 * leaves the product page (Server Action argument / localStorage), so
 * anything that is charged or shipped must re-validate it against the
 * catalog's `ProductOptions` (`validateOption` in lib/commerce/options.ts).
 */
export type SelectedOption =
  | { kind: "ringSize"; value: string }
  | { kind: "chainLength"; lengthCm: number };

export interface Product extends ProductSummary {
  description: string;
  /** Full gallery — image and video/GIF items, in author order. */
  media: MediaItem[];
  /** Full localized category, for display (e.g. the product-detail spec-plate). */
  category?: Category;
  /** What the shopper must choose before buying — see `ProductOptions`. */
  options: ProductOptions;
}

export interface CommerceReadApi {
  getProducts(locale: Locale): Promise<ProductSummary[]>;
  getProductByHandle(handle: string, locale: Locale): Promise<Product | null>;
  /** Pre-checkout guard: current availability for a set of handles. */
  getAvailability(handles: string[]): Promise<Record<string, Availability>>;
  /** All product categories, localized, for the shop's filter chips. */
  getCategories(locale: Locale): Promise<Category[]>;
}
