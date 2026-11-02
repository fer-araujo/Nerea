// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import esMessages from "../messages/es.json";
import type { ProductSummary } from "@/lib/commerce/types";
import {
  ALL,
  CATEGORY_PARAM,
  COLLECTION_PARAM,
  filterProducts,
  slugFromParam,
} from "@/lib/commerce/filters";

// The URL the filter reads its starting selection from. A plain variable the
// mock closes over: each test sets it before rendering.
let currentSearch = "";
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(currentSearch),
}));

// The card is its own unit (it needs the locale-aware Link); a stub keeps this
// file on the filter's own behavior.
vi.mock("@/components/product/ProductCard", () => ({
  ProductCard: ({ product }: { product: ProductSummary }) => (
    <span data-testid="card">{product.title}</span>
  ),
}));

import { CategoryFilter } from "../components/shop/CategoryFilter";

function piece(
  handle: string,
  categorySlug: string,
  collectionSlugs: string[],
): ProductSummary {
  return {
    handle,
    title: handle,
    price: { amount: 100, currency: "MXN" },
    availability: "available",
    cover: null,
    categorySlug,
    collectionSlugs,
  };
}

// Rings and earrings in the seasonal collection, a pendant out of it, a second
// ring that belongs to a different collection, and one piece in two at once.
const PRODUCTS: ProductSummary[] = [
  piece("anillo-muertos", "anillos", ["dia-de-muertos"]),
  piece("anillo-plata", "anillos", ["plata"]),
  piece("aretes-muertos", "aretes", ["dia-de-muertos"]),
  piece("dije-suelto", "dijes", []),
  piece("dije-doble", "dijes", ["dia-de-muertos", "plata"]),
];

const CATEGORIES = [
  { title: "Anillos", slug: "anillos" },
  { title: "Aretes", slug: "aretes" },
  { title: "Dijes", slug: "dijes" },
];
const COLLECTIONS = [
  { title: "Día de Muertos", slug: "dia-de-muertos" },
  { title: "Plata", slug: "plata" },
];

function renderFilter(collections = COLLECTIONS) {
  return render(
    <NextIntlClientProvider locale="es" messages={esMessages}>
      <CategoryFilter
        products={PRODUCTS}
        categories={CATEGORIES}
        collections={collections}
      />
    </NextIntlClientProvider>,
  );
}

function shownHandles(): string[] {
  return screen.getAllByTestId("card").map((card) => card.textContent ?? "");
}

function chip(group: string, label: string): HTMLElement {
  return within(screen.getByRole("list", { name: group })).getByRole("button", {
    name: label,
  });
}

beforeEach(() => {
  currentSearch = "";
  window.history.replaceState(null, "", "/es/shop");
});

describe("filterProducts", () => {
  const none = { category: ALL, collection: ALL };

  it("returns the catalog untouched with both axes on all", () => {
    expect(filterProducts(PRODUCTS, none)).toBe(PRODUCTS);
  });

  it("filters by category alone", () => {
    expect(
      filterProducts(PRODUCTS, { ...none, category: "dijes" }).map((p) => p.handle),
    ).toEqual(["dije-suelto", "dije-doble"]);
  });

  it("filters by collection alone, across categories, including a piece in several", () => {
    expect(
      filterProducts(PRODUCTS, { ...none, collection: "dia-de-muertos" }).map(
        (p) => p.handle,
      ),
    ).toEqual(["anillo-muertos", "aretes-muertos", "dije-doble"]);
    expect(
      filterProducts(PRODUCTS, { ...none, collection: "plata" }).map((p) => p.handle),
    ).toEqual(["anillo-plata", "dije-doble"]);
  });

  it("combines both: a piece must match the category AND the collection", () => {
    expect(
      filterProducts(PRODUCTS, { category: "anillos", collection: "dia-de-muertos" }).map(
        (p) => p.handle,
      ),
    ).toEqual(["anillo-muertos"]);
    expect(
      filterProducts(PRODUCTS, { category: "aretes", collection: "plata" }),
    ).toEqual([]);
  });

  it("treats a piece with no collection data as in none", () => {
    const bare: ProductSummary = { ...piece("x", "anillos", []), collectionSlugs: undefined };

    expect(filterProducts([bare], { ...none, collection: "plata" })).toEqual([]);
    expect(filterProducts([bare], none)).toEqual([bare]);
  });
});

describe("slugFromParam", () => {
  it("accepts a slug the page offers", () => {
    expect(slugFromParam("plata", ["dia-de-muertos", "plata"])).toBe("plata");
  });

  it.each([null, undefined, "", "cerrada"])(
    "falls back to all for %j (missing or not offered)",
    (value) => {
      expect(slugFromParam(value, ["dia-de-muertos", "plata"])).toBe(ALL);
    },
  );
});

describe("CategoryFilter — category + collection", () => {
  it("starts on the whole catalog, with a labeled row of chips per axis", () => {
    renderFilter();

    expect(shownHandles()).toHaveLength(PRODUCTS.length);
    expect(chip("Categoría", "Todas")).toHaveAttribute("aria-pressed", "true");
    expect(chip("Colección", "Todas")).toHaveAttribute("aria-pressed", "true");
    expect(chip("Colección", "Día de Muertos")).toHaveAttribute("aria-pressed", "false");
  });

  it("filters by collection across categories", () => {
    renderFilter();

    fireEvent.click(chip("Colección", "Día de Muertos"));

    expect(shownHandles()).toEqual(["anillo-muertos", "aretes-muertos", "dije-doble"]);
    expect(chip("Colección", "Día de Muertos")).toHaveAttribute("aria-pressed", "true");
  });

  it("combines the category and the collection", () => {
    renderFilter();

    fireEvent.click(chip("Colección", "Día de Muertos"));
    fireEvent.click(chip("Categoría", "Dijes"));

    expect(shownHandles()).toEqual(["dije-doble"]);
    // Going back to "all" on one axis keeps the other.
    fireEvent.click(chip("Categoría", "Todas"));
    expect(shownHandles()).toEqual(["anillo-muertos", "aretes-muertos", "dije-doble"]);
  });

  it("explains an empty combination instead of leaving a blank page", () => {
    renderFilter();

    fireEvent.click(chip("Categoría", "Aretes"));
    fireEvent.click(chip("Colección", "Plata"));

    expect(screen.queryAllByTestId("card")).toHaveLength(0);
    expect(screen.getByText(esMessages.Shop.emptyFilterBody)).toBeInTheDocument();
  });

  it("starts from the URL: ?coleccion= and ?categoria= are both honored", () => {
    currentSearch = `${COLLECTION_PARAM}=dia-de-muertos&${CATEGORY_PARAM}=anillos`;

    renderFilter();

    expect(shownHandles()).toEqual(["anillo-muertos"]);
    expect(chip("Colección", "Día de Muertos")).toHaveAttribute("aria-pressed", "true");
    expect(chip("Categoría", "Anillos")).toHaveAttribute("aria-pressed", "true");
  });

  it("ignores a collection the page does not offer (closed or mistyped)", () => {
    currentSearch = `${COLLECTION_PARAM}=cerrada`;

    renderFilter();

    expect(shownHandles()).toHaveLength(PRODUCTS.length);
    expect(chip("Colección", "Todas")).toHaveAttribute("aria-pressed", "true");
  });

  it("mirrors the selection into the URL, and drops a param when it goes back to all", () => {
    renderFilter();

    fireEvent.click(chip("Colección", "Plata"));
    expect(window.location.search).toBe(`?${COLLECTION_PARAM}=plata`);

    fireEvent.click(chip("Categoría", "Dijes"));
    expect(new URLSearchParams(window.location.search).get(CATEGORY_PARAM)).toBe("dijes");
    expect(new URLSearchParams(window.location.search).get(COLLECTION_PARAM)).toBe("plata");

    fireEvent.click(chip("Colección", "Todas"));
    fireEvent.click(chip("Categoría", "Todas"));
    expect(window.location.search).toBe("");
    expect(window.location.pathname).toBe("/es/shop");
  });

  it("shows no collection row when there are no visible collections", () => {
    renderFilter([]);

    expect(screen.queryByRole("list", { name: "Colección" })).not.toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Categoría" })).toBeInTheDocument();
    expect(shownHandles()).toHaveLength(PRODUCTS.length);
  });
});
