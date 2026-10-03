// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

// What the two new pages SHOW, rendered from mocked data: the joined cost and
// margin per piece, the pending badge, the period totals and the sales list.
// Who may see them is in tests/admin-modules-page-guards.test.ts; what the
// data layer returns is in the *-data tests.
vi.mock("server-only", () => ({}));

const requireAdminMock = vi.fn();
vi.mock("@/lib/admin/auth/session", () => ({
  requireAdmin: (...args: unknown[]) => requireAdminMock(...args),
}));

const listMaterialsMock = vi.fn();
vi.mock("@/lib/admin/data/materials", () => ({
  listMaterials: (...args: unknown[]) => listMaterialsMock(...args),
}));

const listCatalogMock = vi.fn();
vi.mock("@/lib/admin/data/catalog", () => ({
  CATALOG_LIMIT: 500,
  listCatalog: (...args: unknown[]) => listCatalogMock(...args),
}));

const listPiecesMock = vi.fn();
vi.mock("@/lib/admin/data/pieces", () => ({
  listPieces: (...args: unknown[]) => listPiecesMock(...args),
}));

const listSalesMock = vi.fn();
const sumSalesMock = vi.fn();
vi.mock("@/lib/admin/data/sales", () => ({
  SALES_SUM_LIMIT: 2000,
  listSales: (...args: unknown[]) => listSalesMock(...args),
  sumSales: (...args: unknown[]) => sumSalesMock(...args),
}));

vi.mock("@/app/admin/(panel)/piezas/actions", () => ({
  savePieceCostAction: vi.fn(),
}));
vi.mock("@/app/admin/(panel)/ventas/actions", () => ({
  recordManualSaleAction: vi.fn(),
  voidSaleAction: vi.fn(),
}));

import AdminPiecesPage from "@/app/admin/(panel)/piezas/page";
import AdminSalesPage from "@/app/admin/(panel)/ventas/page";

const ADMIN = { uid: "uid-1", email: "admin@example.com" };

function product(overrides: Record<string, unknown> = {}) {
  return {
    handle: "anillo-luna",
    title: "Anillo Luna",
    price: 400_000,
    availability: "available",
    categoryTitle: "Anillos",
    ...overrides,
  };
}

function piece(overrides: Record<string, unknown> = {}) {
  return {
    handle: "anillo-luna",
    costs: { metal: 100_000, stones: 30_000, other: 5_000, labor: 15_000 },
    metalGrams: null,
    materialId: null,
    note: null,
    updatedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  requireAdminMock.mockResolvedValue(ADMIN);
  listMaterialsMock.mockResolvedValue([]);
  listCatalogMock.mockResolvedValue({ products: [], truncated: false });
  listPiecesMock.mockResolvedValue([]);
});

describe("Piezas page", () => {
  async function renderPage(search: { pieza?: string } = {}) {
    render(await AdminPiecesPage({ searchParams: Promise.resolve(search) }));
  }

  it("joins each catalog piece with its cost: total, margin and margin percent", async () => {
    listCatalogMock.mockResolvedValue({ products: [product()], truncated: false });
    listPiecesMock.mockResolvedValue([piece()]);

    await renderPage();

    const row = screen.getByRole("row", { name: /Anillo Luna/ });
    // $4,000.00 price - $1,500.00 cost = $2,500.00 = 62.5 % of the price.
    expect(within(row).getByText("$4,000.00")).toBeInTheDocument();
    expect(within(row).getByText("$1,500.00")).toBeInTheDocument();
    expect(within(row).getByText("$2,500.00")).toBeInTheDocument();
    expect(within(row).getByText("62.5 %")).toBeInTheDocument();
    expect(within(row).queryByText("Costo pendiente")).not.toBeInTheDocument();
    expect(within(row).getByText(/Anillos · Disponible/)).toBeInTheDocument();
  });

  it("shows 'Costo pendiente' and no margin for a piece with no cost recorded", async () => {
    listCatalogMock.mockResolvedValue({
      products: [product({ handle: "aretes-sol", title: "Aretes Sol", price: 90_000, availability: "sold", categoryTitle: null })],
      truncated: false,
    });

    await renderPage();

    const row = screen.getByRole("row", { name: /Aretes Sol/ });
    expect(within(row).getByText("Costo pendiente")).toBeInTheDocument();
    expect(within(row).getAllByText("—")).toHaveLength(2);
    expect(within(row).getByText(/Sin categoría · Vendida/)).toBeInTheDocument();
  });

  it("shows a margin below zero when the piece costs more than it sells for", async () => {
    listCatalogMock.mockResolvedValue({ products: [product({ price: 100_000 })], truncated: false });
    listPiecesMock.mockResolvedValue([
      piece({ costs: { metal: 130_000, stones: 0, other: 0 } }),
    ]);

    await renderPage();

    const row = screen.getByRole("row", { name: /Anillo Luna/ });
    expect(within(row).getByText("-$300.00")).toBeInTheDocument();
    expect(within(row).getByText("-30.0 %")).toBeInTheDocument();
  });

  it("tells a recorded cost of zero apart from no cost at all", async () => {
    listCatalogMock.mockResolvedValue({
      products: [product(), product({ handle: "aretes-sol", title: "Aretes Sol" })],
      truncated: false,
    });
    listPiecesMock.mockResolvedValue([piece({ costs: { metal: 0, stones: 0, other: 0 } })]);

    await renderPage();

    const zero = screen.getByRole("row", { name: /Anillo Luna/ });
    expect(within(zero).queryByText("Costo pendiente")).not.toBeInTheDocument();
    expect(within(zero).getByText("100.0 %")).toBeInTheDocument();
    expect(
      within(screen.getByRole("row", { name: /Aretes Sol/ })).getByText("Costo pendiente"),
    ).toBeInTheDocument();
  });

  it("counts the pieces still pending and links each row to its cost form", async () => {
    listCatalogMock.mockResolvedValue({
      products: [product(), product({ handle: "aretes-sol", title: "Aretes Sol" })],
      truncated: false,
    });
    listPiecesMock.mockResolvedValue([piece()]);

    await renderPage();

    expect(screen.getByText(/2 piezas · 1 con costo pendiente/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Editar costo de Anillo Luna" })).toHaveAttribute(
      "href",
      "/admin/piezas?pieza=anillo-luna#editar-costo",
    );
    expect(screen.getByRole("link", { name: "Editar costo de Aretes Sol" })).toHaveTextContent(
      "Registrar costo",
    );
  });

  it("shows the edit form, with only gram materials in the metal helper, for ?pieza=", async () => {
    listCatalogMock.mockResolvedValue({ products: [product()], truncated: false });
    listPiecesMock.mockResolvedValue([
      piece({ metalGrams: 12.5, materialId: "silver", note: "Con piedra" }),
    ]);
    listMaterialsMock.mockResolvedValue([
      { id: "silver", name: "Plata fina", kind: "fine_silver", unit: "g", stock: 100, avgCost: 1800 },
      { id: "stones", name: "Circones", kind: "stone", unit: "pz", stock: 10, avgCost: 500 },
      { id: "alloy", name: "Liga", kind: "alloy", unit: "g", stock: 50, avgCost: 400 },
      { id: "other-g", name: "Cera", kind: "other", unit: "g", stock: 5, avgCost: 10 },
    ]);

    await renderPage({ pieza: "anillo-luna" });

    expect(screen.getByRole("heading", { name: "Costo de la pieza" })).toBeInTheDocument();
    expect(screen.getByText("Precio en la tienda: $4,000.00")).toBeInTheDocument();
    // The saved values come back into the form.
    expect(screen.getByLabelText("Metal (MXN)")).toHaveValue(1000);
    expect(screen.getByLabelText("Mano de obra (MXN, opcional)")).toHaveValue(150);
    expect(screen.getByLabelText("Gramos de metal")).toHaveValue(12.5);
    expect(screen.getByLabelText("Nota (opcional)")).toHaveValue("Con piedra");
    const options = within(screen.getByLabelText("Material")).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "Elige un material",
      "Plata fina · $18.00 / g",
      "Liga · $4.00 / g",
    ]);
  });

  it("opens an empty form for a piece that has no cost yet", async () => {
    listCatalogMock.mockResolvedValue({ products: [product()], truncated: false });

    await renderPage({ pieza: "anillo-luna" });

    expect(screen.getByLabelText("Metal (MXN)")).toHaveValue(null);
    expect(screen.getByLabelText("Nota (opcional)")).toHaveValue("");
  });

  it("says so for a piece that is not in the catalog", async () => {
    listCatalogMock.mockResolvedValue({ products: [product()], truncated: false });

    await renderPage({ pieza: "fantasma" });

    expect(screen.getByRole("alert")).toHaveTextContent("No encontramos esa pieza");
    expect(screen.queryByRole("heading", { name: "Costo de la pieza" })).not.toBeInTheDocument();
  });

  it("shows a notice instead of the table when the catalog or the costs cannot be read", async () => {
    listCatalogMock.mockRejectedValue(new Error("network down"));
    await renderPage();
    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos cargar el catálogo");

    listCatalogMock.mockResolvedValue({ products: [product()], truncated: false });
    listPiecesMock.mockResolvedValue(null);
    document.body.innerHTML = "";
    await renderPage();
    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos cargar los costos");
  });

  it("explains an empty catalog and warns when it was cut", async () => {
    await renderPage();
    expect(screen.getByText("Aún no hay piezas en el catálogo")).toBeInTheDocument();

    document.body.innerHTML = "";
    listCatalogMock.mockResolvedValue({ products: [product()], truncated: true });
    await renderPage();
    expect(screen.getByRole("status")).toHaveTextContent("más de 500 piezas");
  });
});

describe("Ventas page", () => {
  const TOTALS = {
    count: 2,
    voidedCount: 1,
    subtotal: 275_000,
    shipping: 15_000,
    total: 290_000,
    costOfGoods: 90_000,
    grossProfit: 185_000,
    pendingCount: 0,
    truncated: false,
  };

  function sale(overrides: Record<string, unknown> = {}) {
    return {
      id: "s1",
      source: "manual",
      status: "active",
      date: new Date("2026-10-05T18:00:00Z"),
      items: [{ handle: "anillo-luna", title: "Anillo Luna", price: 185_000, option: "Talla 7" }],
      subtotal: 185_000,
      shipping: 15_000,
      total: 200_000,
      costOfGoods: 60_000,
      costPending: false,
      note: null,
      ...overrides,
    };
  }

  async function renderPage(search: Record<string, string> = {}) {
    render(await AdminSalesPage({ searchParams: Promise.resolve(search) }));
  }

  beforeEach(() => {
    listSalesMock.mockResolvedValue({ sales: [], hasNextPage: false });
    sumSalesMock.mockResolvedValue(TOTALS);
  });

  it("shows the period totals: sales, cost of goods sold, gross profit and shipping apart", async () => {
    await renderPage();

    expect(screen.getByText(/^Ventas · /)).toBeInTheDocument();
    expect(screen.getByText("$2,750.00")).toBeInTheDocument();
    expect(screen.getByText("2 ventas · 1 anulada (no cuentan)")).toBeInTheDocument();
    expect(screen.getByText("Costo de lo vendido").nextSibling).toHaveTextContent("$900.00");
    expect(screen.getByText("Utilidad bruta").nextSibling).toHaveTextContent("$1,850.00");
    expect(screen.getByText("Envíos cobrados").nextSibling).toHaveTextContent("$150.00");
    expect(screen.getByText(/sin el envío/)).toBeInTheDocument();
  });

  it("warns that the gross profit is overstated while sales have a pending cost", async () => {
    sumSalesMock.mockResolvedValue({ ...TOTALS, pendingCount: 2 });

    await renderPage();

    const notice = screen.getByRole("status");
    expect(notice).toHaveTextContent("2 ventas incluyen piezas sin costo registrado");
    expect(within(notice).getByRole("link", { name: "Piezas" })).toHaveAttribute(
      "href",
      "/admin/piezas",
    );
  });

  it("flags totals that are partial because the period is too large", async () => {
    sumSalesMock.mockResolvedValue({ ...TOTALS, truncated: true });

    await renderPage();

    expect(screen.getByRole("status")).toHaveTextContent("más de 2000 ventas");
  });

  it("shows a notice instead of figures when the totals cannot be calculated", async () => {
    sumSalesMock.mockResolvedValue(null);

    await renderPage();

    expect(screen.getByText("No pudimos calcular los totales.")).toBeInTheDocument();
  });

  it("marks the period tabs and links them with the period in the URL", async () => {
    await renderPage({ period: "last-month" });

    const nav = screen.getByRole("navigation", { name: "Periodo" });
    expect(within(nav).getByRole("link", { name: "Mes anterior" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(nav).getByRole("link", { name: "Este mes" })).toHaveAttribute("href", "/admin/ventas");
    expect(within(nav).getByRole("link", { name: "Este año" })).toHaveAttribute(
      "href",
      "/admin/ventas?period=this-year",
    );
  });

  it("lists each sale with its source badge, pieces, cost and gross profit", async () => {
    listSalesMock.mockResolvedValue({
      sales: [
        sale({
          id: "stripe_cs_1",
          source: "stripe",
          items: [
            { handle: "anillo-luna", title: "Anillo Luna", price: 185_000, option: "Talla 7" },
            { handle: "aretes-sol", title: "Aretes Sol", price: 90_000 },
          ],
          subtotal: 275_000,
          total: 290_000,
          costOfGoods: 60_000,
          costPending: true,
        }),
      ],
      hasNextPage: false,
    });

    await renderPage();

    const item = screen.getByRole("heading", { name: "Anillo Luna + 1 más" }).closest("li");
    expect(item).not.toBeNull();
    const row = within(item as HTMLElement);
    expect(row.getByText("Tienda en línea")).toBeInTheDocument();
    expect(row.getByText("Costo pendiente")).toBeInTheDocument();
    expect(row.getByText("Anillo Luna · Talla 7")).toBeInTheDocument();
    expect(row.getByText("Aretes Sol")).toBeInTheDocument();
    expect(row.getByText("$2,900.00")).toBeInTheDocument();
    expect(row.getByText("Envío $150.00")).toBeInTheDocument();
    expect(row.getByText("Costo $600.00")).toBeInTheDocument();
    expect(row.getByText("Utilidad $2,150.00")).toBeInTheDocument();
  });

  it("mutes a voided sale, badges it and offers no way to void it again", async () => {
    listSalesMock.mockResolvedValue({
      sales: [sale({ id: "voided", status: "void" }), sale({ id: "live" })],
      hasNextPage: false,
    });

    await renderPage();

    const [voided, live] = screen
      .getAllByRole("heading", { name: "Anillo Luna" })
      .map((heading) => heading.closest("li") as HTMLElement);
    expect(voided).toHaveClass("opacity-60");
    expect(within(voided).getByText("Anulada")).toBeInTheDocument();
    expect(within(voided).queryByRole("button", { name: "Anular venta" })).not.toBeInTheDocument();
    expect(live).not.toHaveClass("opacity-60");
    expect(within(live).getByText("Manual")).toBeInTheDocument();
    expect(within(live).getByRole("button", { name: "Anular venta" })).toBeInTheDocument();
  });

  it("offers 'Anular venta' on manual sales only, never on a Stripe sale", async () => {
    listSalesMock.mockResolvedValue({
      sales: [sale({ id: "stripe_cs_1", source: "stripe" })],
      hasNextPage: false,
    });

    await renderPage();

    expect(screen.queryByRole("button", { name: "Anular venta" })).not.toBeInTheDocument();
  });

  it("renders a stored note as plain text, never as markup", async () => {
    listSalesMock.mockResolvedValue({
      sales: [sale({ note: '<img src=x onerror="alert(1)">' })],
      hasNextPage: false,
    });

    await renderPage();

    expect(screen.getByText('<img src=x onerror="alert(1)">')).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });

  it("says so for an empty period and for a page past the end", async () => {
    await renderPage();
    expect(screen.getByText("Sin ventas en este periodo")).toBeInTheDocument();

    document.body.innerHTML = "";
    await renderPage({ page: "3" });
    expect(screen.getByText("No hay más ventas")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ir a las más recientes" })).toBeInTheDocument();
  });

  it("shows a notice instead of the list when the sales cannot be read", async () => {
    listSalesMock.mockResolvedValue(null);

    await renderPage();

    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos cargar las ventas");
  });

  it("offers only AVAILABLE pieces in the manual sale form", async () => {
    listCatalogMock.mockResolvedValue({
      products: [
        product(),
        product({ handle: "aretes-sol", title: "Aretes Sol", availability: "sold" }),
        product({ handle: "dije-mar", title: "Dije Mar" }),
      ],
      truncated: false,
    });

    await renderPage();

    const options = within(screen.getByLabelText("Pieza")).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "Elige una pieza",
      "Anillo Luna",
      "Dije Mar",
    ]);
  });

  it("explains when nothing is left to sell, and when the catalog cannot be read", async () => {
    await renderPage();
    expect(screen.getByText(/No hay piezas disponibles para vender/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Registrar venta" })).not.toBeInTheDocument();

    document.body.innerHTML = "";
    listCatalogMock.mockRejectedValue(new Error("network down"));
    await renderPage();
    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos cargar tus piezas");
  });
});
