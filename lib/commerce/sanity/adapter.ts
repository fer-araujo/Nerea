import { toAvailability, toMoney } from "../transforms";
import type {
  Availability,
  Category,
  CommerceReadApi,
  MediaItem,
  Product,
  ProductSummary,
} from "../types";
import {
  CATEGORIES_REVALIDATE_SECONDS,
  CATEGORIES_TAG,
  PRODUCTS_REVALIDATE_SECONDS,
  PRODUCTS_TAG,
  sanityClient,
} from "./client";
import {
  AVAILABILITY_BY_HANDLES_QUERY,
  CATEGORIES_QUERY,
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

interface RawProductSummary {
  handle: string;
  title: string;
  price: RawMoney;
  status: string;
  cover: RawMediaItem | null;
  categorySlug: string | null;
}

interface RawProduct {
  handle: string;
  title: string;
  description: string;
  price: RawMoney;
  status: string;
  media: (RawMediaItem | null)[];
  category: RawCategory | null;
}

interface RawAvailability {
  handle: string;
  status: string;
}

// ISR-tagged fetch: 60s keeps a just-sold piece from lingering without
// per-request latency; a Sanity webhook -> revalidateTag("products") is the
// stretch upgrade for instant reflection (see design.md).
function productsFetchOptions() {
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

function toProductSummary(raw: RawProductSummary): ProductSummary {
  return {
    handle: raw.handle,
    title: raw.title,
    price: toMoney(raw.price),
    availability: toAvailability(raw.status),
    cover: toMediaItem(raw.cover),
    categorySlug: raw.categorySlug ?? undefined,
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

  async getProductByHandle(handle, locale) {
    const product = await sanityClient.fetch<RawProduct | null>(
      PRODUCT_BY_HANDLE_QUERY,
      { handle, locale },
      productsFetchOptions(),
    );
    return product ? toProduct(product) : null;
  },

  async getAvailability(handles) {
    const result: Record<string, Availability> = {};
    if (handles.length === 0) {
      return result;
    }

    const found = await sanityClient.fetch<RawAvailability[]>(
      AVAILABILITY_BY_HANDLES_QUERY,
      { handles },
      productsFetchOptions(),
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
};
