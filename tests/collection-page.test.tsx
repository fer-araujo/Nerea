// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import esMessages from "../messages/es.json";
import type { Collection, ProductSummary } from "@/lib/commerce/types";

// `next-intl/server` resolves to a client-only stub outside a real Next.js
// request, so it is mocked on top of the real message files (same approach as
// tests/shop-catalog.test.tsx): the assertions read the actual copy. The mock
// accepts both call shapes the pages use: `getTranslations("Ns")` and
// `getTranslations({ locale, namespace })`.
vi.mock("next-intl/server", () => ({
  setRequestLocale: () => {},
  getTranslations: async (arg: string | { namespace: string }) => {
    const namespace = typeof arg === "string" ? arg : arg.namespace;
    const scoped = (
      esMessages as unknown as Record<string, Record<string, unknown>>
    )[namespace];
    return (key: string) =>
      key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], scoped);
  },
}));

// next/image needs Next's image pipeline (loader config, optimizer); outside a
// Next request it does not resolve under Vitest. A plain <img> stand-in keeps
// what matters here: the Sanity URL and the alt text MediaFrame hands it.
vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) => (
    // eslint-disable-next-line @next/next/no-img-element -- test stand-in for next/image
    <img src={src} alt={alt} />
  ),
}));

const getCollectionBySlug = vi.fn();
const getCollections = vi.fn();
const getProducts = vi.fn();
vi.mock("@/lib/commerce", () => ({
  commerce: {
    getCollectionBySlug: (...args: unknown[]) => getCollectionBySlug(...args),
    getCollections: (...args: unknown[]) => getCollections(...args),
    getProducts: (...args: unknown[]) => getProducts(...args),
  },
}));

import CollectionPage, {
  generateMetadata,
  generateStaticParams,
} from "../app/[locale]/colecciones/[slug]/page";
import CollectionsIndexPage from "../app/[locale]/colecciones/page";

const DIA_DE_MUERTOS: Collection = {
  title: "Día de Muertos",
  slug: "dia-de-muertos",
  description: "Piezas inspiradas en la luz de las velas.",
  cover: null,
};

function piece(handle: string, collectionSlugs: string[]): ProductSummary {
  return {
    handle,
    title: `Pieza ${handle}`,
    price: { amount: 185000, currency: "MXN" },
    availability: "available",
    cover: null,
    categorySlug: "anillos",
    collectionSlugs,
  };
}

const PRODUCTS = [
  piece("anillo", ["dia-de-muertos"]),
  piece("aretes", ["dia-de-muertos", "plata"]),
  piece("dije", []),
  piece("brazalete", ["plata"]),
];

async function renderCollectionPage(slug = "dia-de-muertos") {
  const jsx = await CollectionPage({
    params: Promise.resolve({ locale: "es", slug }),
  });
  return render(
    <NextIntlClientProvider locale="es" messages={esMessages}>
      {jsx}
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  getProducts.mockResolvedValue(PRODUCTS);
});

describe("collection page", () => {
  it("renders the collection's title, description and exactly its pieces", async () => {
    getCollectionBySlug.mockResolvedValue(DIA_DE_MUERTOS);

    await renderCollectionPage();

    expect(
      screen.getByRole("heading", { level: 1, name: "Día de Muertos" }),
    ).toBeInTheDocument();
    expect(screen.getByText(DIA_DE_MUERTOS.description)).toBeInTheDocument();

    // Its two pieces (one of them also in another collection), not the others.
    const grid = screen.getByRole("list");
    expect(within(grid).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("Pieza anillo")).toBeInTheDocument();
    expect(screen.getByText("Pieza aretes")).toBeInTheDocument();
    expect(screen.queryByText("Pieza dije")).not.toBeInTheDocument();
    expect(screen.queryByText("Pieza brazalete")).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Pieza anillo/ }),
    ).toHaveAttribute("href", "/es/products/anillo");
  });

  it("looks the collection up by its slug and the catalog by the locale", async () => {
    getCollectionBySlug.mockResolvedValue(DIA_DE_MUERTOS);

    await renderCollectionPage();

    expect(getCollectionBySlug).toHaveBeenCalledWith("dia-de-muertos", "es");
    expect(getProducts).toHaveBeenCalledWith("es");
  });

  it("shows the cover through next/image when there is one, named by its alt text", async () => {
    getCollectionBySlug.mockResolvedValue({
      ...DIA_DE_MUERTOS,
      cover: {
        kind: "image",
        url: "https://cdn.sanity.io/images/p/d/cover.jpg",
        alt: "Velas y cempasúchil",
      },
    });

    await renderCollectionPage();

    expect(screen.getByRole("img", { name: "Velas y cempasúchil" })).toHaveAttribute(
      "src",
      "https://cdn.sanity.io/images/p/d/cover.jpg",
    );
  });

  it("renders without a cover", async () => {
    getCollectionBySlug.mockResolvedValue(DIA_DE_MUERTOS);

    await renderCollectionPage();

    expect(screen.queryByRole("img", { name: "Día de Muertos" })).not.toBeInTheDocument();
  });

  it("shows an empty state, with a way out, for a collection with no pieces", async () => {
    getCollectionBySlug.mockResolvedValue(DIA_DE_MUERTOS);
    getProducts.mockResolvedValue([piece("dije", [])]);

    await renderCollectionPage();

    expect(screen.getByText(esMessages.Collections.emptyPiecesTitle)).toBeInTheDocument();
    expect(screen.getByText(esMessages.Collections.emptyPiecesBody)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: esMessages.Collections.viewShop }),
    ).toHaveAttribute("href", "/es/shop");
    expect(screen.queryByText("Pieza dije")).not.toBeInTheDocument();
  });

  it("returns notFound for a hidden or unknown collection (the data layer answers null)", async () => {
    getCollectionBySlug.mockResolvedValue(null);

    await expect(
      CollectionPage({ params: Promise.resolve({ locale: "es", slug: "cerrada" }) }),
    ).rejects.toMatchObject({ digest: expect.stringContaining("404") });
  });

  it("returns notFound, not a crash, when the data layer fails", async () => {
    getCollectionBySlug.mockRejectedValue(new Error("sanity down"));

    await expect(
      CollectionPage({ params: Promise.resolve({ locale: "es", slug: "x" }) }),
    ).rejects.toMatchObject({ digest: expect.stringContaining("404") });
  });

  it("still renders the collection when only the catalog read fails", async () => {
    getCollectionBySlug.mockResolvedValue(DIA_DE_MUERTOS);
    getProducts.mockRejectedValue(new Error("sanity down"));

    await renderCollectionPage();

    expect(screen.getByText(esMessages.Collections.emptyPiecesTitle)).toBeInTheDocument();
  });
});

describe("collection page — metadata and static params", () => {
  it("builds its metadata from the collection, canonical to its own URL", async () => {
    getCollectionBySlug.mockResolvedValue(DIA_DE_MUERTOS);

    const metadata = await generateMetadata({
      params: Promise.resolve({ locale: "es", slug: "dia-de-muertos" }),
    });

    expect(metadata.title).toBe("Día de Muertos · nerea");
    expect(metadata.description).toBe(DIA_DE_MUERTOS.description);
    expect(metadata.alternates?.canonical).toMatch(/\/es\/colecciones\/dia-de-muertos$/);
  });

  it("keeps a hidden collection out of the index", async () => {
    getCollectionBySlug.mockResolvedValue(null);

    const metadata = await generateMetadata({
      params: Promise.resolve({ locale: "es", slug: "cerrada" }),
    });

    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it("pre-renders only the visible collections, and survives a failing backend", async () => {
    getCollections.mockResolvedValue([DIA_DE_MUERTOS]);
    expect(await generateStaticParams({ params: { locale: "es" } })).toEqual([
      { slug: "dia-de-muertos" },
    ]);
    expect(getCollections).toHaveBeenCalledWith("es");

    getCollections.mockRejectedValue(new Error("sanity down"));
    expect(await generateStaticParams({ params: { locale: "es" } })).toEqual([]);
  });
});

describe("collections index", () => {
  async function renderIndex() {
    const jsx = await CollectionsIndexPage({
      params: Promise.resolve({ locale: "es" }),
    });
    return render(
      <NextIntlClientProvider locale="es" messages={esMessages}>
        {jsx}
      </NextIntlClientProvider>,
    );
  }

  it("lists each visible collection, linking to its page", async () => {
    getCollections.mockResolvedValue([
      DIA_DE_MUERTOS,
      { ...DIA_DE_MUERTOS, title: "Plata", slug: "plata", description: "" },
    ]);

    await renderIndex();

    expect(
      screen.getByRole("heading", { level: 1, name: esMessages.Collections.title }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Día de Muertos/ }),
    ).toHaveAttribute("href", "/es/colecciones/dia-de-muertos");
    expect(screen.getByRole("link", { name: /Plata/ })).toHaveAttribute(
      "href",
      "/es/colecciones/plata",
    );
  });

  it("shows an intentional empty state when there is nothing to list or the read fails", async () => {
    getCollections.mockResolvedValue([]);
    await renderIndex();
    expect(screen.getByText(esMessages.Collections.emptyTitle)).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("degrades to the same empty state on a data-layer failure", async () => {
    getCollections.mockRejectedValue(new Error("sanity down"));

    await renderIndex();

    expect(screen.getByText(esMessages.Collections.emptyBody)).toBeInTheDocument();
  });
});
