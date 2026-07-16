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

export interface ProductSummary {
  handle: string;
  title: string;
  price: Money;
  availability: Availability;
  image: string;
}

export interface Product extends ProductSummary {
  description: string;
  images: string[];
}

export interface CommerceReadApi {
  getProducts(locale: Locale): Promise<ProductSummary[]>;
  getProductByHandle(handle: string, locale: Locale): Promise<Product | null>;
  /** Pre-checkout guard: current availability for a set of handles. */
  getAvailability(handles: string[]): Promise<Record<string, Availability>>;
}
