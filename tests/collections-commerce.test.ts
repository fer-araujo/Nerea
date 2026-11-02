import { beforeEach, describe, expect, it, vi } from "vitest";

// Same edge as tests/commerce-sanity-adapter.test.ts: only the network client is
// replaced, so the real GROQ constants and the real adapter run, and what is
// pinned is how a RAW document (shaped like the projection) becomes the domain
// view model.
const fetchMock = vi.fn();

vi.mock("@/lib/commerce/sanity/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/commerce/sanity/client")>()),
  sanityClient: { fetch: (...args: unknown[]) => fetchMock(...args) },
}));

import { isCollectionVisible } from "@/lib/commerce/collections";
import { fixturesApi } from "@/lib/commerce/fixtures";
import { sanityApi } from "@/lib/commerce/sanity/adapter";
import {
  COLLECTIONS_REVALIDATE_SECONDS,
  COLLECTIONS_TAG,
} from "@/lib/commerce/sanity/client";
import {
  COLLECTION_BY_SLUG_QUERY,
  COLLECTIONS_QUERY,
  PRODUCT_BY_HANDLE_QUERY,
  PRODUCTS_LIST_QUERY,
} from "@/lib/commerce/sanity/queries";

beforeEach(() => {
  vi.resetAllMocks();
});

// The visible-collection rule, as it must appear in every query that lists or
// resolves a collection.
const VISIBLE = "active == true && (!defined(endsAt) || dateTime(endsAt) > dateTime(now()))";

describe("GROQ — collection visibility", () => {
  it("lists only collections that are on and not past their closing date", () => {
    expect(COLLECTIONS_QUERY).toContain('_type == "collection"');
    expect(COLLECTIONS_QUERY).toContain(VISIBLE);
  });

  it("applies the same rule to a single collection, so a hidden one resolves to null", () => {
    expect(COLLECTION_BY_SLUG_QUERY).toContain("slug.current == $slug");
    expect(COLLECTION_BY_SLUG_QUERY).toContain(VISIBLE);
    expect(COLLECTION_BY_SLUG_QUERY).toContain("[0]");
  });

  it("compares dates as dates, against the server's own clock", () => {
    for (const query of [COLLECTIONS_QUERY, COLLECTION_BY_SLUG_QUERY]) {
      // now() is evaluated by Content Lake: no timestamp is built in code and
      // pasted into the query, and none is passed as a param either (a moving
      // $now would change the request URL on every call and defeat the ISR cache).
      expect(query).toContain("dateTime(now())");
      expect(query).toContain("dateTime(endsAt)");
      expect(query).not.toContain("$now");
      expect(query).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    }
  });

  it("orders by the author's number, unnumbered ones last, then by name", () => {
    expect(COLLECTIONS_QUERY).toContain(
      "order(coalesce(order, 999999) asc, title.es asc)",
    );
  });

  it("drops hidden collections from the pieces too (list and detail)", () => {
    // Each `@` is a reference, dereferenced before the check.
    const refs =
      "collections[@->active == true && (!defined(@->endsAt) || dateTime(@->endsAt) > dateTime(now()))]";

    expect(PRODUCTS_LIST_QUERY).toContain(`${refs}->slug.current`);
    expect(PRODUCT_BY_HANDLE_QUERY).toContain(`${refs}->{`);
  });

  it("is built from constants only: every dynamic value is a $param", () => {
    expect(COLLECTIONS_QUERY).toContain("$locale");
    expect(COLLECTION_BY_SLUG_QUERY).toContain("$locale");
    for (const query of [COLLECTIONS_QUERY, COLLECTION_BY_SLUG_QUERY]) {
      expect(query).not.toContain("${");
    }
  });
});

describe("sanityApi — collections", () => {
  const ISR = {
    next: { revalidate: COLLECTIONS_REVALIDATE_SECONDS, tags: [COLLECTIONS_TAG] },
  };

  it("passes the locale as a param and reads through the tagged ISR cache", async () => {
    fetchMock.mockResolvedValue([]);

    await sanityApi.getCollections("en");

    const [query, params, options] = fetchMock.mock.calls[0];
    expect(query).toBe(COLLECTIONS_QUERY);
    expect(params).toEqual({ locale: "en" });
    expect(options).toEqual(ISR);
    expect(COLLECTIONS_TAG).toBe("collections");
    expect(COLLECTIONS_REVALIDATE_SECONDS).toBe(60);
  });

  it("passes the slug as a param, never inside the query text", async () => {
    fetchMock.mockResolvedValue(null);

    await sanityApi.getCollectionBySlug("dia-de-muertos", "es");

    const [query, params, options] = fetchMock.mock.calls[0];
    expect(query).toBe(COLLECTION_BY_SLUG_QUERY);
    expect(params).toEqual({ slug: "dia-de-muertos", locale: "es" });
    expect(query).not.toContain("dia-de-muertos");
    expect(options).toEqual(ISR);
  });

  it("maps a collection with a cover to the domain shape", async () => {
    fetchMock.mockResolvedValue([
      {
        title: "Día de Muertos",
        slug: "dia-de-muertos",
        description: "Piezas de temporada",
        cover: { url: "https://cdn.sanity.io/images/p/d/cover.jpg", alt: "Velas" },
      },
    ]);

    expect(await sanityApi.getCollections("es")).toEqual([
      {
        title: "Día de Muertos",
        slug: "dia-de-muertos",
        description: "Piezas de temporada",
        cover: {
          kind: "image",
          url: "https://cdn.sanity.io/images/p/d/cover.jpg",
          alt: "Velas",
        },
      },
    ]);
  });

  it.each([
    ["no cover at all", null],
    ["a cover without a resolved asset", { url: null, alt: "Velas" }],
  ])("maps %s to no cover", async (_label, cover) => {
    fetchMock.mockResolvedValue({
      title: "Día de Muertos",
      slug: "dia-de-muertos",
      description: null,
      cover,
    });

    const collection = await sanityApi.getCollectionBySlug("dia-de-muertos", "es");

    expect(collection?.cover).toBeNull();
    // A missing description is an empty string, never null.
    expect(collection?.description).toBe("");
  });

  it("leaves an empty alt off the cover so the title is used instead", async () => {
    fetchMock.mockResolvedValue({
      title: "Día de Muertos",
      slug: "dia-de-muertos",
      description: "",
      cover: { url: "https://cdn.sanity.io/images/p/d/cover.jpg", alt: "" },
    });

    const collection = await sanityApi.getCollectionBySlug("dia-de-muertos", "es");

    expect(collection?.cover?.alt).toBeUndefined();
  });

  it("answers null for a slug the query does not return (unknown OR hidden)", async () => {
    fetchMock.mockResolvedValue(null);

    expect(await sanityApi.getCollectionBySlug("cerrada", "es")).toBeNull();
  });

  it("exposes the collection slugs on the listing summary, empty when there are none", async () => {
    const base = {
      title: "Anillo",
      price: { amount: 185000, currency: "MXN" },
      status: "available",
      cover: null,
      categorySlug: "anillos",
    };
    fetchMock.mockResolvedValue([
      { ...base, handle: "a", collectionSlugs: ["dia-de-muertos", "plata"] },
      { ...base, handle: "b", collectionSlugs: [] },
      { ...base, handle: "c", collectionSlugs: null },
    ]);

    const products = await sanityApi.getProducts("es");

    expect(products.map((product) => product.collectionSlugs)).toEqual([
      ["dia-de-muertos", "plata"],
      [],
      [],
    ]);
  });

  it("exposes the visible collections (title + slug) on the product detail", async () => {
    fetchMock.mockResolvedValue({
      handle: "anillo",
      title: "Anillo",
      description: "",
      price: { amount: 185000, currency: "MXN" },
      status: "available",
      media: [],
      category: { title: "Anillos", slug: "anillos" },
      collections: [{ title: "Día de Muertos", slug: "dia-de-muertos" }],
      purchaseOption: null,
      categoryPurchaseOption: null,
      ringSizes: [],
      chainLengths: [],
      optionDefaults: null,
    });

    const product = await sanityApi.getProductByHandle("anillo", "es");

    expect(product?.collections).toEqual([
      { title: "Día de Muertos", slug: "dia-de-muertos" },
    ]);
  });
});

describe("isCollectionVisible", () => {
  const NOW = new Date("2026-11-02T12:00:00.000Z");

  it("shows a collection that is on and has no closing date", () => {
    expect(isCollectionVisible({ active: true }, NOW)).toBe(true);
    expect(isCollectionVisible({ active: true, endsAt: null }, NOW)).toBe(true);
  });

  it("shows one whose closing date is still ahead", () => {
    expect(
      isCollectionVisible({ active: true, endsAt: "2026-11-03T00:00:00.000Z" }, NOW),
    ).toBe(true);
  });

  it("hides one that is switched off, whatever its date", () => {
    expect(isCollectionVisible({ active: false }, NOW)).toBe(false);
    expect(isCollectionVisible({ active: false, endsAt: "2027-01-01T00:00:00Z" }, NOW)).toBe(
      false,
    );
    // Never set (a document created outside Studio) is not "on" either.
    expect(isCollectionVisible({}, NOW)).toBe(false);
    expect(isCollectionVisible({ active: null }, NOW)).toBe(false);
  });

  it("hides one whose closing date has passed, the instant it arrives", () => {
    expect(
      isCollectionVisible({ active: true, endsAt: "2026-11-01T00:00:00.000Z" }, NOW),
    ).toBe(false);
    expect(isCollectionVisible({ active: true, endsAt: NOW.toISOString() }, NOW)).toBe(
      false,
    );
  });

  it("hides one whose closing date does not parse: a typo can only hide, never leave one up", () => {
    expect(isCollectionVisible({ active: true, endsAt: "pronto" }, NOW)).toBe(false);
    expect(isCollectionVisible({ active: true, endsAt: "" }, NOW)).toBe(false);
  });
});

describe("fixturesApi — collections parity", () => {
  it("lists the sample collection, localized", async () => {
    const es = await fixturesApi.getCollections("es");
    const en = await fixturesApi.getCollections("en");

    expect(es.map((collection) => collection.slug)).toEqual(["dia-de-muertos"]);
    expect(es[0].title).toBe("Día de Muertos");
    expect(en[0].title).toBe("Day of the Dead");
    expect(es[0]).toEqual(
      expect.objectContaining({ description: expect.any(String), cover: null }),
    );
  });

  it("resolves it by slug and answers null for an unknown one", async () => {
    expect((await fixturesApi.getCollectionBySlug("dia-de-muertos", "es"))?.slug).toBe(
      "dia-de-muertos",
    );
    expect(await fixturesApi.getCollectionBySlug("no-existe", "es")).toBeNull();
  });

  it("puts pieces of different categories in the same collection, and leaves one out", async () => {
    const products = await fixturesApi.getProducts("es");
    const inCollection = products.filter((product) =>
      product.collectionSlugs?.includes("dia-de-muertos"),
    );

    expect(inCollection.length).toBeGreaterThan(1);
    expect(new Set(inCollection.map((product) => product.categorySlug)).size).toBe(
      inCollection.length,
    );
    expect(inCollection.length).toBeLessThan(products.length);
  });

  it("exposes the collections on the product detail, localized", async () => {
    const [handle] = (await fixturesApi.getProducts("en"))
      .filter((product) => product.collectionSlugs?.length)
      .map((product) => product.handle);

    const product = await fixturesApi.getProductByHandle(handle, "en");

    expect(product?.collections).toEqual([
      { title: "Day of the Dead", slug: "dia-de-muertos" },
    ]);
  });
});
