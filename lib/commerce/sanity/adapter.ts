import { toAvailability, toMoney } from "../transforms";
import type {
  Availability,
  CommerceReadApi,
  Product,
  ProductSummary,
} from "../types";
import { PRODUCTS_REVALIDATE_SECONDS, PRODUCTS_TAG, sanityClient } from "./client";
import {
  AVAILABILITY_BY_HANDLES_QUERY,
  PRODUCT_BY_HANDLE_QUERY,
  PRODUCTS_LIST_QUERY,
} from "./queries";

interface RawMoney {
  amount: number;
  currency: string;
}

interface RawProductSummary {
  handle: string;
  title: string;
  price: RawMoney;
  status: string;
  image: string | null;
}

interface RawProduct {
  handle: string;
  title: string;
  description: string;
  price: RawMoney;
  status: string;
  images: (string | null)[];
}

interface RawAvailability {
  handle: string;
  status: string;
}

// ISR-tagged fetch: 60s keeps a just-sold piece from lingering without
// per-request latency; a Sanity webhook -> revalidateTag("products") is the
// stretch upgrade for instant reflection (see design.md).
function fetchOptions() {
  return {
    next: { revalidate: PRODUCTS_REVALIDATE_SECONDS, tags: [PRODUCTS_TAG] },
  };
}

function toProductSummary(raw: RawProductSummary): ProductSummary {
  return {
    handle: raw.handle,
    title: raw.title,
    price: toMoney(raw.price),
    availability: toAvailability(raw.status),
    image: raw.image ?? "",
  };
}

function toProduct(raw: RawProduct): Product {
  const images = raw.images.filter((url): url is string => Boolean(url));
  return {
    handle: raw.handle,
    title: raw.title,
    description: raw.description,
    price: toMoney(raw.price),
    availability: toAvailability(raw.status),
    image: images[0] ?? "",
    images,
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
      fetchOptions(),
    );
    return products.map(toProductSummary);
  },

  async getProductByHandle(handle, locale) {
    const product = await sanityClient.fetch<RawProduct | null>(
      PRODUCT_BY_HANDLE_QUERY,
      { handle, locale },
      fetchOptions(),
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
      fetchOptions(),
    );

    for (const handle of handles) {
      const match = found.find((item) => item.handle === handle);
      // A handle Sanity doesn't return (deleted/unknown) fails safe to
      // "sold" — never let a missing product look purchasable.
      result[handle] = match ? toAvailability(match.status) : "sold";
    }
    return result;
  },
};
