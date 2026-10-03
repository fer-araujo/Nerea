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

import { DEFAULT_RING_SIZES } from "@/lib/commerce/options";
import { sanityApi } from "@/lib/commerce/sanity/adapter";
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
