import { beforeEach, describe, expect, it, vi } from "vitest";

// Only the network client is replaced: the real GROQ constants, the real
// adapter and the real option resolver run, so this pins how a RAW product
// (shaped like the GROQ projection) becomes the `options` the storefront and
// checkoutAction use.
const fetchMock = vi.fn();

vi.mock("@/lib/commerce/sanity/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/commerce/sanity/client")>()),
  sanityClient: { fetch: (...args: unknown[]) => fetchMock(...args) },
}));

import { fixturesApi } from "@/lib/commerce/fixtures";
import { DEFAULT_RING_SIZES } from "@/lib/commerce/options";
import { sanityApi } from "@/lib/commerce/sanity/adapter";
import {
  PRODUCTS_REVALIDATE_SECONDS,
  PRODUCTS_TAG,
} from "@/lib/commerce/sanity/client";
import { PRODUCT_BY_HANDLE_QUERY } from "@/lib/commerce/sanity/queries";

function rawProduct(overrides: Record<string, unknown> = {}) {
  return {
    handle: "anillo-luna",
    title: "Anillo luna",
    description: "Plata fundida a la cera perdida",
    price: { amount: 185000, currency: "MXN" },
    status: "available",
    media: [],
    category: { title: "Anillos", slug: "anillos" },
    purchaseOption: null,
    categoryPurchaseOption: null,
    ringSizes: [],
    chainLengths: [],
    optionDefaults: null,
    ...overrides,
  };
}

async function optionsFor(overrides: Record<string, unknown>) {
  fetchMock.mockResolvedValue(rawProduct(overrides));
  const product = await sanityApi.getProductByHandle("anillo-luna", "es");
  return product?.options;
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("PRODUCT_BY_HANDLE_QUERY — purchase option projection", () => {
  it("projects the category's option next to the piece's own", () => {
    expect(PRODUCT_BY_HANDLE_QUERY).toContain(
      '"categoryPurchaseOption": category->purchaseOption',
    );
    expect(PRODUCT_BY_HANDLE_QUERY).toContain('"purchaseOption": purchaseOption,');
  });

  it('does not coalesce the piece\'s option to "none", which would stop it inheriting', () => {
    expect(PRODUCT_BY_HANDLE_QUERY).not.toContain("coalesce(purchaseOption");
  });

  it("stays parameterized: the handle and locale travel as params, never inside the query text", async () => {
    fetchMock.mockResolvedValue(rawProduct());

    await sanityApi.getProductByHandle("anillo-luna", "es");

    const [query, params] = fetchMock.mock.calls[0];
    expect(query).toBe(PRODUCT_BY_HANDLE_QUERY);
    expect(params).toEqual({ handle: "anillo-luna", locale: "es" });
    expect(query).toContain("slug.current == $handle");
    expect(query).toContain("$locale");
    expect(query).not.toContain("anillo-luna");
  });
});

// The third argument of sanityClient.fetch is what Next's fetch cache sees.
describe("sanityApi — cache mode of the catalog reads", () => {
  const ISR = {
    next: { revalidate: PRODUCTS_REVALIDATE_SECONDS, tags: [PRODUCTS_TAG] },
  };

  function fetchOptionsOfLastCall() {
    return fetchMock.mock.calls.at(-1)?.[2];
  }

  it("keeps the storefront on the tagged ISR cache by default", async () => {
    fetchMock.mockResolvedValue(rawProduct());
    await sanityApi.getProductByHandle("anillo-luna", "es");
    expect(fetchOptionsOfLastCall()).toEqual(ISR);

    fetchMock.mockResolvedValue([{ handle: "anillo-luna", status: "available" }]);
    await sanityApi.getAvailability(["anillo-luna"]);
    expect(fetchOptionsOfLastCall()).toEqual(ISR);
  });

  it("stays on the cache when fresh is explicitly false", async () => {
    fetchMock.mockResolvedValue(rawProduct());
    await sanityApi.getProductByHandle("anillo-luna", "es", { fresh: false });
    expect(fetchOptionsOfLastCall()).toEqual(ISR);

    fetchMock.mockResolvedValue([{ handle: "anillo-luna", status: "available" }]);
    await sanityApi.getAvailability(["anillo-luna"], { fresh: false });
    expect(fetchOptionsOfLastCall()).toEqual(ISR);
  });

  it("reads a product uncached when fresh is requested", async () => {
    fetchMock.mockResolvedValue(rawProduct());

    const product = await sanityApi.getProductByHandle("anillo-luna", "es", {
      fresh: true,
    });

    expect(product?.handle).toBe("anillo-luna");
    // no-store and NO `next` key: Next warns when a fetch sets both a cache
    // mode and next.revalidate.
    expect(fetchOptionsOfLastCall()).toEqual({ cache: "no-store" });
    expect(fetchOptionsOfLastCall()).not.toHaveProperty("next");
  });

  it("reads availability uncached when fresh is requested, and still fails safe to sold", async () => {
    fetchMock.mockResolvedValue([{ handle: "anillo-luna", status: "available" }]);

    const availability = await sanityApi.getAvailability(
      ["anillo-luna", "desconocido"],
      { fresh: true },
    );

    expect(availability).toEqual({ "anillo-luna": "available", desconocido: "sold" });
    expect(fetchOptionsOfLastCall()).toEqual({ cache: "no-store" });
    expect(fetchOptionsOfLastCall()).not.toHaveProperty("next");
  });

  it("leaves the listing and the categories on the cache: fresh is not offered there", async () => {
    fetchMock.mockResolvedValue([]);

    await sanityApi.getProducts("es");
    expect(fetchOptionsOfLastCall()).toEqual(ISR);

    await sanityApi.getCategories("es");
    expect(fetchOptionsOfLastCall()).toMatchObject({ next: { tags: ["categories"] } });
  });

  it("is accepted by the fixtures adapter too, where it changes nothing", async () => {
    const [handle] = (await fixturesApi.getProducts("es")).map((p) => p.handle);

    expect(await fixturesApi.getAvailability([handle], { fresh: true })).toEqual(
      await fixturesApi.getAvailability([handle]),
    );
    expect(await fixturesApi.getProductByHandle(handle, "es", { fresh: true })).toEqual(
      await fixturesApi.getProductByHandle(handle, "es"),
    );
  });
});

describe("sanityApi.getProductByHandle — option resolved from the category", () => {
  it("makes a piece that never set an option (all existing documents) follow a ring-size category", async () => {
    expect(
      await optionsFor({ purchaseOption: null, categoryPurchaseOption: "ringSize" }),
    ).toEqual({ kind: "ringSize", values: [...DEFAULT_RING_SIZES] });
  });

  it('makes a piece set to "Según la categoría" follow the category', async () => {
    expect(
      await optionsFor({
        purchaseOption: "inherit",
        categoryPurchaseOption: "chainLength",
      }),
    ).toMatchObject({ kind: "chainLength" });
  });

  it("uses the site defaults for the inherited kind's values", async () => {
    expect(
      await optionsFor({
        purchaseOption: null,
        categoryPurchaseOption: "ringSize",
        optionDefaults: { ringSizes: ["6", "7"], chainLengths: [] },
      }),
    ).toEqual({ kind: "ringSize", values: ["6", "7"] });
  });

  it("lets the piece's explicit none beat the category", async () => {
    expect(
      await optionsFor({
        purchaseOption: "none",
        categoryPurchaseOption: "ringSize",
      }),
    ).toEqual({ kind: "none" });
  });

  it("lets the piece's explicit choice beat a different category choice", async () => {
    expect(
      await optionsFor({
        purchaseOption: "chainLength",
        categoryPurchaseOption: "ringSize",
      }),
    ).toMatchObject({ kind: "chainLength" });
  });

  it("takes no option when the piece has no category", async () => {
    expect(
      await optionsFor({
        category: null,
        purchaseOption: null,
        categoryPurchaseOption: null,
      }),
    ).toEqual({ kind: "none" });
  });
});

// A piece's stock decides what the storefront sells. Every document created
// before the `stock` field existed has none (GROQ projects it as null), and
// then the legacy `status` decides: nothing about an existing catalog changes.
describe("sanityApi — stock", () => {
  it("projects the stock next to the legacy status in the three product reads", async () => {
    const { PRODUCTS_LIST_QUERY, AVAILABILITY_BY_HANDLES_QUERY } = await import(
      "@/lib/commerce/sanity/queries"
    );

    for (const query of [
      PRODUCT_BY_HANDLE_QUERY,
      PRODUCTS_LIST_QUERY,
      AVAILABILITY_BY_HANDLES_QUERY,
    ]) {
      expect(query).toMatch(/\n\s*stock,?\n/);
      expect(query).toMatch(/\n\s*status,?\n/);
    }
  });

  it("exposes the stock on the detail product, and 'available' while it is above zero", async () => {
    fetchMock.mockResolvedValue(rawProduct({ stock: 4, status: "sold" }));

    const product = await sanityApi.getProductByHandle("anillo-luna", "es");

    // The stock wins over a stale legacy status.
    expect(product).toMatchObject({ stock: 4, availability: "available" });
  });

  it("is sold at zero, whatever the legacy status says", async () => {
    fetchMock.mockResolvedValue(rawProduct({ stock: 0, status: "available" }));

    const product = await sanityApi.getProductByHandle("anillo-luna", "es");

    expect(product).toMatchObject({ stock: 0, availability: "sold" });
  });

  it.each([
    ["available", 1, "available"],
    ["sold", 0, "sold"],
    // The fail-safe of the legacy reading: nothing but "available" is for sale.
    ["borrador", 0, "sold"],
    [null, 0, "sold"],
  ])(
    "falls back to the legacy status %j when the document has no stock: stock %i, %s",
    async (status, stock, availability) => {
      fetchMock.mockResolvedValue(rawProduct({ status, stock: null }));

      const product = await sanityApi.getProductByHandle("anillo-luna", "es");

      expect(product).toMatchObject({ stock, availability });
    },
  );

  it("treats an absent stock key like a null one (a document read through a fixture)", async () => {
    fetchMock.mockResolvedValue(rawProduct({ status: "available" }));

    const product = await sanityApi.getProductByHandle("anillo-luna", "es");

    expect(product).toMatchObject({ stock: 1, availability: "available" });
  });

  it("exposes the stock on every card of the listing too", async () => {
    fetchMock.mockResolvedValue([
      { handle: "serie", title: "Serie", price: { amount: 100, currency: "MXN" }, status: "available", stock: 3, cover: null, categorySlug: null, collectionSlugs: [] },
      { handle: "unica", title: "Única", price: { amount: 100, currency: "MXN" }, status: "available", stock: null, cover: null, categorySlug: null, collectionSlugs: [] },
      { handle: "agotada", title: "Agotada", price: { amount: 100, currency: "MXN" }, status: "available", stock: 0, cover: null, categorySlug: null, collectionSlugs: [] },
    ]);

    const products = await sanityApi.getProducts("es");

    expect(products.map(({ handle, stock, availability }) => [handle, stock, availability])).toEqual([
      ["serie", 3, "available"],
      ["unica", 1, "available"],
      ["agotada", 0, "sold"],
    ]);
  });

  it("reads availability from the stock too, failing safe to sold for a handle Sanity did not return", async () => {
    fetchMock.mockResolvedValue([
      { handle: "serie", status: "sold", stock: 2 },
      { handle: "agotada", status: "available", stock: 0 },
      { handle: "antigua", status: "available", stock: null },
    ]);

    const result = await sanityApi.getAvailability(["serie", "agotada", "antigua", "fantasma"]);

    expect(result).toEqual({
      serie: "available",
      agotada: "sold",
      antigua: "available",
      fantasma: "sold",
    });
  });

  it("floors a fractional stock and never goes below zero", async () => {
    fetchMock.mockResolvedValue(rawProduct({ stock: 2.9 }));
    expect((await sanityApi.getProductByHandle("a", "es"))?.stock).toBe(2);

    fetchMock.mockResolvedValue(rawProduct({ stock: -3 }));
    expect(await sanityApi.getProductByHandle("a", "es")).toMatchObject({
      stock: 0,
      availability: "sold",
    });
  });

  it("gives the fixtures the same shape: a stock that matches their availability", async () => {
    const products = await fixturesApi.getProducts("es");

    for (const product of products) {
      expect(product.stock).toBe(product.availability === "available" ? 1 : 0);
    }
  });
});

// A piece being edited in Studio has a published document AND a draft
// (`drafts.<id>`) with the same slug. Whatever the client's perspective, the
// lookups that decide a sale must never see the draft.
describe("sanityApi — drafts", () => {
  it("excludes drafts from the queries that decide a sale: the product and the availability", async () => {
    const { AVAILABILITY_BY_HANDLES_QUERY } = await import("@/lib/commerce/sanity/queries");

    for (const query of [PRODUCT_BY_HANDLE_QUERY, AVAILABILITY_BY_HANDLES_QUERY]) {
      expect(query).toContain('!(_id in path("drafts.**"))');
    }
  });

  it("keeps the handles parameterized next to the draft filter", async () => {
    const { AVAILABILITY_BY_HANDLES_QUERY } = await import("@/lib/commerce/sanity/queries");

    expect(AVAILABILITY_BY_HANDLES_QUERY).toContain("slug.current in $handles");
    expect(PRODUCT_BY_HANDLE_QUERY).toContain("slug.current == $handle");
  });
});
