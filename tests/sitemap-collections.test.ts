import { beforeEach, describe, expect, it, vi } from "vitest";

// The commerce layer is the edge. `getCollections` is contractually VISIBLE
// collections only (hidden ones are filtered out by the data layer, see
// tests/collections-commerce.test.ts), so what is pinned here is that the
// sitemap lists exactly what it is handed — and nothing the layer withheld.
const getProducts = vi.fn();
const getCollections = vi.fn();
vi.mock("@/lib/commerce", () => ({
  commerce: {
    getProducts: (...args: unknown[]) => getProducts(...args),
    getCollections: (...args: unknown[]) => getCollections(...args),
  },
}));

import sitemap from "../app/sitemap";

function collection(slug: string) {
  return { title: slug, slug, description: "", cover: null };
}

beforeEach(() => {
  vi.resetAllMocks();
  getProducts.mockResolvedValue([]);
  getCollections.mockResolvedValue([]);
});

async function urls() {
  return (await sitemap()).map((entry) => entry.url);
}

describe("sitemap — collections", () => {
  it("lists the collections index in both locales, with hreflang alternates", async () => {
    const entries = await sitemap();

    for (const locale of ["es", "en"]) {
      const entry = entries.find((candidate) =>
        candidate.url.endsWith(`/${locale}/colecciones`),
      );

      expect(entry, `${locale}/colecciones`).toBeDefined();
      expect(Object.keys(entry?.alternates?.languages ?? {})).toEqual(
        expect.arrayContaining(["es", "en", "x-default"]),
      );
    }
  });

  it("lists each visible collection in both locales", async () => {
    getCollections.mockResolvedValue([collection("dia-de-muertos"), collection("plata")]);

    const all = await urls();

    for (const locale of ["es", "en"]) {
      for (const slug of ["dia-de-muertos", "plata"]) {
        expect(all.some((url) => url.endsWith(`/${locale}/colecciones/${slug}`))).toBe(true);
      }
    }
  });

  it("does not list a collection the data layer withheld (hidden or closed)", async () => {
    // The data layer returns only the visible one; "cerrada" is never handed over.
    getCollections.mockResolvedValue([collection("dia-de-muertos")]);

    const all = await urls();

    expect(all.some((url) => url.includes("/colecciones/cerrada"))).toBe(false);
    expect(all.filter((url) => url.includes("/colecciones/"))).toHaveLength(2);
  });

  it("asks for the default locale once: slugs are language-neutral", async () => {
    await sitemap();

    expect(getCollections).toHaveBeenCalledTimes(1);
    expect(getCollections).toHaveBeenCalledWith("es");
  });

  it("keeps the products and the static routes when the collections read fails", async () => {
    getCollections.mockRejectedValue(new Error("sanity down"));
    getProducts.mockResolvedValue([{ handle: "anillo" }]);

    const all = await urls();

    expect(all.some((url) => url.endsWith("/es/products/anillo"))).toBe(true);
    expect(all.some((url) => url.endsWith("/es/shop"))).toBe(true);
    expect(all.some((url) => url.includes("/colecciones/"))).toBe(false);
  });

  it("keeps the collections when the products read fails", async () => {
    getProducts.mockRejectedValue(new Error("sanity down"));
    getCollections.mockResolvedValue([collection("dia-de-muertos")]);

    const all = await urls();

    expect(all.some((url) => url.endsWith("/es/colecciones/dia-de-muertos"))).toBe(true);
  });
});
