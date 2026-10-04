// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

// The period tabs are one shared component (Resumen, Ventas, Inversiones) and
// a scrolling row: this file pins that the row can never grow a vertical
// scrollbar, and that the two pages which used to carry their own copy now
// render the shared one. The AdminNav half of the same rule is in
// tests/admin-nav.test.tsx; the Resumen page's use is in
// tests/admin-summary-page.test.tsx.
vi.mock("server-only", () => ({}));

const requireAdminMock = vi.fn();
vi.mock("@/lib/admin/auth/session", () => ({
  requireAdmin: (...args: unknown[]) => requireAdminMock(...args),
}));

const listSalesMock = vi.fn();
const sumSalesMock = vi.fn();
vi.mock("@/lib/admin/data/sales", () => ({
  SALES_SUM_LIMIT: 2000,
  listSales: (...args: unknown[]) => listSalesMock(...args),
  sumSales: (...args: unknown[]) => sumSalesMock(...args),
}));

const listCatalogMock = vi.fn();
vi.mock("@/lib/admin/data/catalog", () => ({
  CATALOG_LIMIT: 500,
  listCatalog: (...args: unknown[]) => listCatalogMock(...args),
}));

const listPurchasesMock = vi.fn();
const sumPurchasesMock = vi.fn();
vi.mock("@/lib/admin/data/purchases", () => ({
  PURCHASE_SUM_LIMIT: 2000,
  listPurchases: (...args: unknown[]) => listPurchasesMock(...args),
  sumPurchases: (...args: unknown[]) => sumPurchasesMock(...args),
}));

const listMaterialsMock = vi.fn();
vi.mock("@/lib/admin/data/materials", () => ({
  listMaterials: (...args: unknown[]) => listMaterialsMock(...args),
}));

vi.mock("@/app/admin/(panel)/ventas/actions", () => ({
  recordManualSaleAction: vi.fn(),
  voidSaleAction: vi.fn(),
  refreshSaleFeeAction: vi.fn(),
}));
vi.mock("@/app/admin/(panel)/inversiones/actions", () => ({
  recordPurchaseAction: vi.fn(),
}));

import AdminInvestmentsPage from "@/app/admin/(panel)/inversiones/page";
import AdminSalesPage from "@/app/admin/(panel)/ventas/page";
import { PeriodNav } from "@/components/admin/PeriodNav";
import type { PeriodKey } from "@/lib/admin/domain/periods";

const ADMIN = { uid: "uid-1", email: "admin@example.com" };

const NO_VERTICAL_OVERFLOW = [
  "overflow-x-auto",
  "overflow-y-hidden",
  "[scrollbar-width:none]",
  "[&::-webkit-scrollbar]:hidden",
];

function hrefFor(period: PeriodKey): string {
  return `/somewhere?p=${period}`;
}

function periodNav(): HTMLElement {
  return screen.getByRole("navigation", { name: "Periodo" });
}

beforeEach(() => {
  vi.resetAllMocks();
  requireAdminMock.mockResolvedValue(ADMIN);
});

describe("PeriodNav", () => {
  it("links the three periods in order, marking only the current one", () => {
    render(<PeriodNav current="last-month" hrefFor={hrefFor} />);

    const links = within(periodNav()).getAllByRole("link");
    expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Este mes", "/somewhere?p=this-month"],
      ["Mes anterior", "/somewhere?p=last-month"],
      ["Este año", "/somewhere?p=this-year"],
    ]);
    expect(
      links.filter((link) => link.getAttribute("aria-current") === "page").map((link) => link.textContent),
    ).toEqual(["Mes anterior"]);
  });

  it("scrolls sideways on a phone without ever growing a vertical scrollbar", () => {
    render(<PeriodNav current="this-month" hrefFor={hrefFor} />);

    // `overflow-x: auto` alone makes `overflow-y` compute to `auto`, so a single
    // pixel of vertical overflow would show the tiny up/down scrollbar.
    expect(periodNav()).toHaveClass(...NO_VERTICAL_OVERFLOW);
  });

  it("puts the hairline on a wrapper, so the active underline can sit on it without overflowing the row", () => {
    render(<PeriodNav current="this-month" hrefFor={hrefFor} className="mt-10" />);

    const nav = periodNav();
    const wrapper = nav.parentElement as HTMLElement;
    expect(wrapper).toHaveClass("border-b", "border-line", "mt-10");
    // The scrolling row carries no border of its own to overlap.
    expect(nav).not.toHaveClass("border-b");
    expect(nav).toHaveClass("-mb-px");
  });

  it("keeps each tab's underline and focus ring inside its own box", () => {
    render(<PeriodNav current="this-month" hrefFor={hrefFor} />);

    for (const link of within(periodNav()).getAllByRole("link")) {
      expect(link).toHaveClass("border-b-2", "focus-visible:-outline-offset-2!");
      // A negative margin is what pulled the underline out of the row.
      expect(link).not.toHaveClass("-mb-px");
    }
  });

  it("draws the underline in brass on the current tab only", () => {
    render(<PeriodNav current="this-year" hrefFor={hrefFor} />);

    expect(screen.getByRole("link", { name: "Este año" })).toHaveClass("border-brass");
    expect(screen.getByRole("link", { name: "Este mes" })).toHaveClass("border-transparent");
  });
});

describe("Ventas and Inversiones render the shared PeriodNav", () => {
  async function renderSales(search: Record<string, string> = {}) {
    listSalesMock.mockResolvedValue({ sales: [], hasNextPage: false });
    sumSalesMock.mockResolvedValue({
      count: 0,
      voidedCount: 0,
      testCount: 0,
      subtotal: 0,
      shipping: 0,
      total: 0,
      costOfGoods: 0,
      grossProfit: 0,
      pendingCount: 0,
      fees: 0,
      pendingFeeCount: 0,
      truncated: false,
    });
    listCatalogMock.mockResolvedValue({ products: [], truncated: false });
    return render(await AdminSalesPage({ searchParams: Promise.resolve(search) }));
  }

  async function renderInvestments(search: Record<string, string> = {}) {
    listPurchasesMock.mockResolvedValue({ purchases: [], hasNextPage: false });
    sumPurchasesMock.mockResolvedValue({ count: 0, totalCost: 0, truncated: false });
    listMaterialsMock.mockResolvedValue([]);
    return render(await AdminInvestmentsPage({ searchParams: Promise.resolve(search) }));
  }

  it.each([
    ["Ventas", renderSales],
    ["Inversiones", renderInvestments],
  ] as const)(
    "%s: one period row, the shared one, with the no-vertical-overflow classes",
    async (_name, renderPage) => {
      const view = await renderPage();

      expect(view.container.querySelectorAll("nav")).toHaveLength(1);
      expect(periodNav()).toHaveClass(...NO_VERTICAL_OVERFLOW, "-mb-px");
      // The shared component's wrapper: the hairline plus the page's top margin.
      expect(periodNav().parentElement).toHaveClass("border-b", "border-line", "mt-10");
    },
  );

  it.each([
    ["Ventas", renderSales, "/admin/ventas"],
    ["Inversiones", renderInvestments, "/admin/inversiones"],
  ] as const)(
    "%s: keeps its period params (the default period has none) and marks the current tab",
    async (_name, renderPage, path) => {
      await renderPage({ period: "last-month" });

      const nav = within(periodNav());
      expect(nav.getByRole("link", { name: "Este mes" })).toHaveAttribute("href", path);
      expect(nav.getByRole("link", { name: "Mes anterior" })).toHaveAttribute(
        "href",
        `${path}?period=last-month`,
      );
      expect(nav.getByRole("link", { name: "Este año" })).toHaveAttribute(
        "href",
        `${path}?period=this-year`,
      );
      expect(nav.getByRole("link", { name: "Mes anterior" })).toHaveAttribute(
        "aria-current",
        "page",
      );
      expect(nav.getByRole("link", { name: "Este mes" })).not.toHaveAttribute("aria-current");
    },
  );

  it.each([
    ["Ventas", renderSales],
    ["Inversiones", renderInvestments],
  ] as const)("%s: falls back to this month for an unknown period", async (_name, renderPage) => {
    await renderPage({ period: "forever" });

    expect(within(periodNav()).getByRole("link", { name: "Este mes" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});
