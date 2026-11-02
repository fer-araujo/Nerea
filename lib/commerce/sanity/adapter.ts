import {
  resolveProductOptions,
  type RawOptionDefaults,
  type RawOptionSource,
} from "../options";
import { toAvailability, toMoney } from "../transforms";
import type {
  Availability,
  Category,
  Collection,
  CollectionRef,
  CommerceReadApi,
  CommerceReadOptions,
  MediaItem,
  Product,
  ProductSummary,
} from "../types";
import {
  CATEGORIES_REVALIDATE_SECONDS,
  CATEGORIES_TAG,
  COLLECTIONS_REVALIDATE_SECONDS,
  COLLECTIONS_TAG,
  PRODUCTS_REVALIDATE_SECONDS,
  PRODUCTS_TAG,
  sanityClient,
} from "./client";
import {
  AVAILABILITY_BY_HANDLES_QUERY,
  CATEGORIES_QUERY,
  COLLECTION_BY_SLUG_QUERY,
  COLLECTIONS_QUERY,
  PRODUCT_BY_HANDLE_QUERY,
  PRODUCTS_LIST_QUERY,
} from "./queries";

interface RawMoney {
  amount: number;
  currency: string;
}

// Exported so lib/site-settings/adapter.ts can reuse the exact same raw
// shape and resolution logic (toMediaItem below) for siteSettings' `logo`/
// `heroMedia[0]`, instead of a second, possibly-drifting implementation.
export interface RawMediaItem {
  kind: "image" | "video";
  url: string | null;
}

interface RawCategory {
  title: string;
  slug: string;
}

interface RawCollectionRef {
  title: string;
  slug: string;
}

interface RawCollection extends RawCollectionRef {
  description: string | null;
  cover: { url: string | null; alt: string | null } | null;
}

interface RawProductSummary {
  handle: string;
  title: string;
  price: RawMoney;
  status: string;
  cover: RawMediaItem | null;
  categorySlug: string | null;
  collectionSlugs: string[] | null;
}

// `purchaseOption` / `ringSizes` / `chainLengths` are the piece's own option
// fields; `categoryPurchaseOption` is its category's choice (what an
// "inherit"/unset piece falls back to); `optionDefaults` is the "siteSettings"
// singleton's lists, projected in the same query (null when that document does
// not exist yet).
interface RawProduct extends RawOptionSource {
  handle: string;
  title: string;
  description: string;
  price: RawMoney;
  status: string;
  media: (RawMediaItem | null)[];
  category: RawCategory | null;
  collections: RawCollectionRef[] | null;
  optionDefaults: RawOptionDefaults | null;
}

interface RawAvailability {
  handle: string;
  status: string;
}

// Storefront reads are ISR-tagged: 60s is the safety net, and the Sanity
// webhook (app/api/revalidate/route.ts) plus the sale paths expire the
// PRODUCTS_TAG on demand so changes show up right away.
//
// `fresh` is the money-path escape hatch (checkoutAction): `cache: "no-store"`
// and NO `next` key, because Next warns when a fetch sets both a cache mode and
// `next.revalidate`. The ISR cache can serve a piece as available for a while
// after it sold, which would let a one-of-one piece be sold twice.
function productsFetchOptions(options?: CommerceReadOptions) {
  if (options?.fresh) {
    return { cache: "no-store" as const };
  }
  return {
    next: { revalidate: PRODUCTS_REVALIDATE_SECONDS, tags: [PRODUCTS_TAG] },
  };
}

function categoriesFetchOptions() {
  return {
    next: {
      revalidate: CATEGORIES_REVALIDATE_SECONDS,
      tags: [CATEGORIES_TAG],
    },
  };
}

// The collection reads share one cache tag. `getCollectionBySlug` is a plain
// collections read too: its pieces come from `getProducts` (tagged PRODUCTS_TAG),
// so a sale refreshes the grid without this read having to know about it.
function collectionsFetchOptions() {
  return {
    next: {
      revalidate: COLLECTIONS_REVALIDATE_SECONDS,
      tags: [COLLECTIONS_TAG],
    },
  };
}

// A media item with no resolved asset URL (a dangling/broken reference) is
// dropped rather than surfaced — the UI's "no media" fallback
// (PlaceholderBlock) is a better outcome than an <img>/<video> pointed at
// `null`.
export function toMediaItem(raw: RawMediaItem | null | undefined): MediaItem | null {
  if (!raw?.url) return null;
  return { kind: raw.kind, url: raw.url };
}

function toMediaList(raw: (RawMediaItem | null)[]): MediaItem[] {
  return raw
    .map((item) => toMediaItem(item))
    .filter((item): item is MediaItem => item !== null);
}

function toCategory(raw: RawCategory | null): Category | undefined {
  return raw ? { title: raw.title, slug: raw.slug } : undefined;
}

function toCollectionRef(raw: RawCollectionRef): CollectionRef {
  return { title: raw.title, slug: raw.slug };
}

// A cover with no resolved asset URL (an alt typed before any upload, or a
// dangling reference) is "no cover", same call as `toMediaItem`. The alt is
// optional on the wire; an empty one is left off so MediaFrame falls back to
// the collection's title.
function toCollection(raw: RawCollection): Collection {
  return {
    title: raw.title,
    slug: raw.slug,
    description: raw.description ?? "",
    cover: raw.cover?.url
      ? {
          kind: "image",
          url: raw.cover.url,
          alt: raw.cover.alt || undefined,
        }
      : null,
  };
}

function toProductSummary(raw: RawProductSummary): ProductSummary {
  return {
    handle: raw.handle,
    title: raw.title,
    price: toMoney(raw.price),
    availability: toAvailability(raw.status),
    cover: toMediaItem(raw.cover),
    categorySlug: raw.categorySlug ?? undefined,
    collectionSlugs: raw.collectionSlugs ?? [],
  };
}

function toProduct(raw: RawProduct): Product {
  const media = toMediaList(raw.media);
  return {
    handle: raw.handle,
    title: raw.title,
    description: raw.description,
    price: toMoney(raw.price),
    availability: toAvailability(raw.status),
    cover: media[0] ?? null,
    media,
    category: toCategory(raw.category),
    collections: (raw.collections ?? []).map(toCollectionRef),
    options: resolveProductOptions(raw, raw.optionDefaults),
  };
}

// Implements CommerceReadApi via Sanity. Compiles and is import-safe even
// with zero products in the project (lib/commerce/index.ts imports this
// module unconditionally regardless of COMMERCE_SOURCE) — every query below
// only runs when one of these methods is actually called, and each handles
// an empty/missing result without throwing.
export const sanityApi: CommerceReadApi = {
  async getProducts(locale) {
    const products = await sanityClient.fetch<RawProductSummary[]>(
      PRODUCTS_LIST_QUERY,
      { locale },
      productsFetchOptions(),
    );
    return products.map(toProductSummary);
  },

  async getProductByHandle(handle, locale, options) {
    const product = await sanityClient.fetch<RawProduct | null>(
      PRODUCT_BY_HANDLE_QUERY,
      { handle, locale },
      productsFetchOptions(options),
    );
    return product ? toProduct(product) : null;
  },

  async getAvailability(handles, options) {
    const result: Record<string, Availability> = {};
    if (handles.length === 0) {
      return result;
    }

    const found = await sanityClient.fetch<RawAvailability[]>(
      AVAILABILITY_BY_HANDLES_QUERY,
      { handles },
      productsFetchOptions(options),
    );

    for (const handle of handles) {
      const match = found.find((item) => item.handle === handle);
      // A handle Sanity doesn't return (deleted/unknown) fails safe to
      // "sold" — never let a missing product look purchasable.
      result[handle] = match ? toAvailability(match.status) : "sold";
    }
    return result;
  },

  async getCategories(locale) {
    const categories = await sanityClient.fetch<RawCategory[]>(
      CATEGORIES_QUERY,
      { locale },
      categoriesFetchOptions(),
    );
    return categories.map((category) => ({
      title: category.title,
      slug: category.slug,
    }));
  },

  async getCollections(locale) {
    const collections = await sanityClient.fetch<RawCollection[]>(
      COLLECTIONS_QUERY,
      { locale },
      collectionsFetchOptions(),
    );
    return collections.map(toCollection);
  },

  async getCollectionBySlug(slug, locale) {
    const collection = await sanityClient.fetch<RawCollection | null>(
      COLLECTION_BY_SLUG_QUERY,
      { slug, locale },
      collectionsFetchOptions(),
    );
    return collection ? toCollection(collection) : null;
  },
};
