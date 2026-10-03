import "server-only";
import { sanityClient } from "@/lib/commerce/sanity/client";
import { toAvailability } from "@/lib/commerce/transforms";
import type { Availability } from "@/lib/commerce/types";
import { isCentavos } from "@/lib/admin/domain/money";

// The catalog as the ADMIN sees it: every product the Studio holds, sold ones
// included, with its category title. The storefront adapter
// (lib/commerce/sanity/adapter.ts) is not used here on purpose:
//   - it is cached for 60 seconds, so a piece just sold (a manual sale marks
//     it in Sanity) would still read "available" here, and an availability
//     check meant to stop a double sale must not be stale;
//   - its listing carries only the category's slug, not its title;
//   - what the storefront lists is a storefront decision (it may well hide
//     sold pieces one day); the admin always needs all of them.
// So these queries carry no `next` fetch options: they are never cached.
//
// Contract: a Sanity failure REJECTS (callers decide how to degrade). Both
// queries are parameterized — `$limit` / `$handles` are bound by the client,
// never concatenated into the GROQ text, so a value can't alter its structure.

/** A jeweler's catalog is dozens of pieces; this is a bound, not a page size. */
export const CATALOG_LIMIT = 500;

export interface CatalogProduct {
  handle: string;
  /** Spanish title (the panel is Spanish-only), "" when the piece has none. */
  title: string;
  /** Base price, integer centavos. */
  price: number;
  availability: Availability;
  categoryTitle: string | null;
}

export interface Catalog {
  products: CatalogProduct[];
  /** True when the catalog holds more than CATALOG_LIMIT products. */
  truncated: boolean;
}

interface RawCatalogProduct {
  handle: string | null;
  title: string | null;
  price: number | null;
  status: string | null;
  category: { title: string | null } | null;
}

const PRODUCT_PROJECTION = `{
  "handle": slug.current,
  "title": coalesce(title.es, ""),
  "price": coalesce(price.amount, 0),
  status,
  "category": category->{ "title": coalesce(title.es, "") }
}`;

const CATALOG_QUERY = `
*[_type == "product" && defined(slug.current)] | order(_createdAt desc) [0...$limit] ${PRODUCT_PROJECTION}
`;

const CATALOG_BY_HANDLES_QUERY = `
*[_type == "product" && slug.current in $handles] ${PRODUCT_PROJECTION}
`;

function toCatalogProduct(raw: RawCatalogProduct): CatalogProduct | null {
  if (typeof raw.handle !== "string" || raw.handle === "") {
    return null;
  }
  return {
    handle: raw.handle,
    title: typeof raw.title === "string" ? raw.title : "",
    // A missing or malformed price reads as 0, like the storefront adapter;
    // the manual-sale form then asks for the real one.
    price:
      typeof raw.price === "number" && isCentavos(raw.price) ? raw.price : 0,
    // Anything but the literal "available" is sold: never let a doubtful
    // piece look sellable.
    availability: toAvailability(raw.status),
    categoryTitle:
      typeof raw.category?.title === "string" && raw.category.title !== ""
        ? raw.category.title
        : null,
  };
}

function toCatalogProducts(raw: RawCatalogProduct[]): CatalogProduct[] {
  return raw.flatMap((item) => {
    const product = toCatalogProduct(item);
    return product ? [product] : [];
  });
}

/** Every product, newest first, sold ones included. Rejects on a Sanity failure. */
export async function listCatalog(): Promise<Catalog> {
  const raw = await sanityClient.fetch<RawCatalogProduct[]>(CATALOG_QUERY, {
    // One extra document tells us whether the catalog was cut.
    limit: CATALOG_LIMIT + 1,
  });

  return {
    products: toCatalogProducts(raw.slice(0, CATALOG_LIMIT)),
    truncated: raw.length > CATALOG_LIMIT,
  };
}

/**
 * The products with these handles, by handle. A handle the catalog doesn't
 * know is simply absent from the map. Rejects on a Sanity failure.
 */
export async function getCatalogProducts(
  handles: readonly string[],
): Promise<Map<string, CatalogProduct>> {
  const unique = [...new Set(handles)];
  if (unique.length === 0) {
    return new Map();
  }

  const raw = await sanityClient.fetch<RawCatalogProduct[]>(
    CATALOG_BY_HANDLES_QUERY,
    { handles: unique },
  );

  return new Map(
    toCatalogProducts(raw).map((product) => [product.handle, product] as const),
  );
}
