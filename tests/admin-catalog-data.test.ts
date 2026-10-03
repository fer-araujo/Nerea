import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// The Sanity client is mocked at the edge: this file covers what the admin
// catalog asks for and how it maps the answer, not the SDK.
const fetchMock = vi.fn();
vi.mock("@/lib/commerce/sanity/client", () => ({
  sanityClient: { fetch: (...args: unknown[]) => fetchMock(...args) },
}));

import {
  CATALOG_LIMIT,
  getCatalogProducts,
  listCatalog,
} from "@/lib/admin/data/catalog";

function raw(overrides: Record<string, unknown> = {}) {
  return {
    handle: "anillo-luna",
    title: "Anillo Luna",
    price: 185_000,
    status: "available",
    category: { title: "Anillos" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("listCatalog", () => {
  it("lists EVERY product, sold ones included, with their category title", async () => {
    fetchMock.mockResolvedValue([
      raw(),
      raw({ handle: "aretes-sol", title: "Aretes Sol", status: "sold", category: null }),
    ]);

    await expect(listCatalog()).resolves.toEqual({
      products: [
        {
          handle: "anillo-luna",
          title: "Anillo Luna",
          price: 185_000,
          availability: "available",
          categoryTitle: "Anillos",
        },
        {
          handle: "aretes-sol",
          title: "Aretes Sol",
          price: 185_000,
          availability: "sold",
          categoryTitle: null,
        },
      ],
      truncated: false,
    });
  });

  it("binds the limit as a parameter and adds no cache options, so it is never stale", async () => {
    fetchMock.mockResolvedValue([]);

    await listCatalog();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const args = fetchMock.mock.calls[0];
    expect(args[0]).toContain("$limit");
    expect(args[0]).toContain('_type == "product"');
    // Nothing is filtered by status: the admin needs the sold pieces too.
    expect(args[0]).not.toContain("status ==");
    expect(args[1]).toEqual({ limit: CATALOG_LIMIT + 1 });
    // No third argument means no `next: { revalidate }` cache.
    expect(args).toHaveLength(2);
  });

  it("says when the catalog was cut, and returns only the first CATALOG_LIMIT", async () => {
    fetchMock.mockResolvedValue(
      Array.from({ length: CATALOG_LIMIT + 1 }, (_, index) =>
        raw({ handle: `pieza-${index}` }),
      ),
    );

    const catalog = await listCatalog();

    expect(catalog.truncated).toBe(true);
    expect(catalog.products).toHaveLength(CATALOG_LIMIT);
  });

  it("degrades a hand-edited or half-filled product instead of throwing", async () => {
    fetchMock.mockResolvedValue([
      raw({ handle: null }),
      raw({ handle: "" }),
      raw({ handle: "sin-precio", price: null, title: null, status: null, category: null }),
      raw({ handle: "precio-roto", price: 12.5 }),
      raw({ handle: "precio-negativo", price: -3 }),
      raw({ handle: "categoria-vacia", category: { title: "" } }),
    ]);

    const { products } = await listCatalog();

    // Without a handle there is nothing to address the piece by.
    expect(products.map((product) => product.handle)).toEqual([
      "sin-precio",
      "precio-roto",
      "precio-negativo",
      "categoria-vacia",
    ]);
    expect(products[0]).toEqual({
      handle: "sin-precio",
      title: "",
      price: 0,
      // Anything but the literal "available" is sold: never a doubtful "yes".
      availability: "sold",
      categoryTitle: null,
    });
    expect(products[1].price).toBe(0);
    expect(products[2].price).toBe(0);
    expect(products[3].categoryTitle).toBeNull();
  });

  it("rejects when Sanity fails, so the page can show its own notice", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));

    await expect(listCatalog()).rejects.toThrow("network down");
  });
});

describe("getCatalogProducts", () => {
  it("returns the products asked for, by handle", async () => {
    fetchMock.mockResolvedValue([raw(), raw({ handle: "aretes-sol", title: "Aretes Sol" })]);

    const found = await getCatalogProducts(["anillo-luna", "aretes-sol"]);

    expect([...found.keys()]).toEqual(["anillo-luna", "aretes-sol"]);
    expect(found.get("aretes-sol")?.title).toBe("Aretes Sol");
  });

  it("passes the handles as a bound parameter, never inside the query text", async () => {
    fetchMock.mockResolvedValue([]);
    const hostile = 'x" || true || "';

    await getCatalogProducts([hostile, hostile, "anillo-luna"]);

    const [query, params] = fetchMock.mock.calls[0];
    expect(query).toContain("$handles");
    expect(query).not.toContain("anillo-luna");
    expect(query).not.toContain("true ||");
    // Deduplicated.
    expect(params).toEqual({ handles: [hostile, "anillo-luna"] });
    expect(fetchMock.mock.calls[0]).toHaveLength(2);
  });

  it("leaves a handle the catalog does not know out of the map", async () => {
    fetchMock.mockResolvedValue([raw()]);

    const found = await getCatalogProducts(["anillo-luna", "fantasma"]);

    expect(found.has("anillo-luna")).toBe(true);
    expect(found.has("fantasma")).toBe(false);
  });

  it("asks nothing for no handles", async () => {
    await expect(getCatalogProducts([])).resolves.toEqual(new Map());

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects when Sanity fails", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));

    await expect(getCatalogProducts(["anillo-luna"])).rejects.toThrow("network down");
  });
});
