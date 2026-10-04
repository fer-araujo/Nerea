// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

// The Resumen page: who may open it, what it reads and when, and what it
// SHOWS from mocked data — the KPI cards, the partial-data warning and the
// failure notices. The numbers' rules are in tests/admin-summary-domain.test.ts,
// the reads in tests/admin-summary-data.test.ts, the chart in
// tests/admin-monthly-chart.test.tsx and the download in
// tests/admin-export-route.test.ts.
vi.mock("server-only", () => ({}));

const requireAdminMock = vi.fn();
vi.mock("@/lib/admin/auth/session", () => ({
  requireAdmin: (...args: unknown[]) => requireAdminMock(...args),
}));

const readSummaryLedgerMock = vi.fn();
vi.mock("@/lib/admin/data/summary", () => ({
  readSummaryLedger: (...args: unknown[]) => readSummaryLedgerMock(...args),
}));

const listMaterialsMock = vi.fn();
vi.mock("@/lib/admin/data/materials", () => ({
  MATERIALS_LIMIT: 200,
  listMaterials: (...args: unknown[]) => listMaterialsMock(...args),
}));

const listCatalogMock = vi.fn();
vi.mock("@/lib/admin/data/catalog", () => ({
  CATALOG_LIMIT: 500,
  listCatalog: (...args: unknown[]) => listCatalogMock(...args),
}));

const countUnreadMessagesMock = vi.fn();
vi.mock("@/lib/admin/data/contact-messages", () => ({
  countUnreadMessages: (...args: unknown[]) => countUnreadMessagesMock(...args),
}));

// The chart (and recharts behind it) is tested on its own; here it is a
// stand-in that lists the months it was handed. createElement, not JSX: the
// factory runs before this file's own imports.
vi.mock("@/components/admin/MonthlyChart", async () => {
  const React = await import("react");
  return {
    MonthlyChart: ({
      points,
    }: {
      points: ReadonlyArray<{
        key: string;
        longLabel: string;
        sales: number;
        investments: number;
        grossProfit: number;
      }>;
    }) =>
      React.createElement(
        "ul",
        { "data-testid": "chart-points" },
        points.map((point) =>
          React.createElement(
            "li",
            { key: point.key },
            `${point.key}|${point.longLabel}|${point.sales}|${point.investments}|${point.grossProfit}`,
          ),
        ),
      ),
  };
});

// A layout's redirect does not stop its page (Next renders them in parallel).
vi.mock("@/app/admin/(panel)/actions", () => ({ logoutAction: vi.fn() }));
vi.mock("@/components/admin/AdminShell", () => ({
  AdminShell: (props: { children: unknown }) => props.children,
}));

import AdminPanelLayout from "@/app/admin/(panel)/layout";
import AdminSummaryPage from "@/app/admin/(panel)/page";

const REDIRECT = "NEXT_REDIRECT /admin/login";
const ADMIN = { uid: "uid-1", email: "admin@example.com" };

function saleRow(overrides: Record<string, unknown> = {}) {
  return {
    date: new Date("2026-10-02T06:00:00Z"),
    status: "active",
    subtotal: 100_000,
    shipping: 0,
    total: 100_000,
    costOfGoods: 40_000,
    costPending: false,
    livemode: true,
    fee: 0,
    feePending: false,
    ...overrides,
  };
}

function purchaseRow(overrides: Record<string, unknown> = {}) {
  return {
    date: new Date("2026-10-02T06:00:00Z"),
    totalCost: 30_000,
    ...overrides,
  };
}

function ledger(overrides: Record<string, unknown> = {}) {
  return { sales: [], purchases: [], truncated: false, ...overrides };
}

function pieces(available: number, sold: number) {
  return [
    ...Array.from({ length: available }, () => ({ availability: "available" })),
    ...Array.from({ length: sold }, () => ({ availability: "sold" })),
  ];
}

const DATA_MOCKS = [
  readSummaryLedgerMock,
  listMaterialsMock,
  listCatalogMock,
  countUnreadMessagesMock,
];

function searchOf(search: { period?: string } = {}) {
  return { searchParams: Promise.resolve(search) };
}

async function renderPage(search: { period?: string } = {}) {
  render(await AdminSummaryPage(searchOf(search)));
}

// The card of a KPI: the element that holds its label (a <dt>) and its figure.
function card(label: string): HTMLElement {
  const term = screen.getByText(label, { selector: "dt" });
  const wrapper = term.parentElement;
  if (!wrapper) {
    throw new Error(`no card for ${label}`);
  }
  return wrapper;
}

beforeEach(() => {
  vi.resetAllMocks();
  // Default: NOT an admin — requireAdmin() redirects (throws).
  requireAdminMock.mockRejectedValue(new Error(REDIRECT));
  readSummaryLedgerMock.mockResolvedValue(ledger());
  listMaterialsMock.mockResolvedValue([]);
  listCatalogMock.mockResolvedValue({ products: [], truncated: false });
  countUnreadMessagesMock.mockResolvedValue(0);
  // 2026-10-02 12:00 in Mexico City.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-02T18:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Resumen page: the guard", () => {
  it("redirects a non-admin BEFORE any data access", async () => {
    await expect(AdminSummaryPage(searchOf())).rejects.toThrow(REDIRECT);

    expect(requireAdminMock).toHaveBeenCalledTimes(1);
    for (const mock of DATA_MOCKS) {
      expect(mock).not.toHaveBeenCalled();
    }
  });

  it("authorizes first and only then reads, for an admin", async () => {
    requireAdminMock.mockResolvedValue(ADMIN);

    await AdminSummaryPage(searchOf());

    for (const mock of DATA_MOCKS) {
      expect(mock).toHaveBeenCalledTimes(1);
      expect(requireAdminMock.mock.invocationCallOrder[0]).toBeLessThan(
        mock.mock.invocationCallOrder[0],
      );
    }
  });

  it("never reads for a non-admin even when rendered in parallel with the layout, as Next does", async () => {
    const settled = await Promise.allSettled([
      AdminPanelLayout({ children: null }),
      AdminSummaryPage(searchOf()),
    ]);

    expect(settled.map((outcome) => outcome.status)).toEqual(["rejected", "rejected"]);
    for (const mock of DATA_MOCKS) {
      expect(mock).not.toHaveBeenCalled();
    }
  });
});

describe("Resumen page: period", () => {
  beforeEach(() => {
    requireAdminMock.mockResolvedValue(ADMIN);
  });

  it("reads ONE window — the chart's twelve months — for this month, in Mexico time", async () => {
    await renderPage();

    expect(readSummaryLedgerMock).toHaveBeenCalledTimes(1);
    const [window] = readSummaryLedgerMock.mock.calls[0] as [{ start: Date; end: Date }];
    expect(window.start.toISOString()).toBe("2025-11-01T06:00:00.000Z");
    expect(window.end.toISOString()).toBe("2026-11-01T06:00:00.000Z");
    expect(screen.getByRole("heading", { name: "Cifras de octubre de 2026" })).toBeInTheDocument();
  });

  it("reaches to the end of the year when the period is this year", async () => {
    await renderPage({ period: "this-year" });

    const [window] = readSummaryLedgerMock.mock.calls[0] as [{ start: Date; end: Date }];
    expect(window.start.toISOString()).toBe("2025-11-01T06:00:00.000Z");
    expect(window.end.toISOString()).toBe("2027-01-01T06:00:00.000Z");
    expect(screen.getByRole("heading", { name: "Cifras de 2026" })).toBeInTheDocument();
  });

  it("shows last month's figures when asked", async () => {
    readSummaryLedgerMock.mockResolvedValue(
      ledger({
        sales: [
          saleRow({ date: new Date("2026-09-15T06:00:00Z"), subtotal: 70_000, costOfGoods: 20_000 }),
          saleRow({ date: new Date("2026-10-02T06:00:00Z"), subtotal: 1_000_000 }),
        ],
      }),
    );

    await renderPage({ period: "last-month" });

    expect(
      screen.getByRole("heading", { name: "Cifras de septiembre de 2026" }),
    ).toBeInTheDocument();
    expect(within(card("Ventas")).getByText("$700.00")).toBeInTheDocument();
  });

  it.each([["forever"], [""], ["__proto__"]])(
    "falls back to this month for the unknown period %j",
    async (period) => {
      await renderPage({ period });

      expect(
        screen.getByRole("heading", { name: "Cifras de octubre de 2026" }),
      ).toBeInTheDocument();
    },
  );

  it("offers the three periods as links, marking the current one", async () => {
    await renderPage({ period: "last-month" });

    const nav = screen.getByRole("navigation", { name: "Periodo" });
    expect(within(nav).getByRole("link", { name: "Este mes" })).toHaveAttribute("href", "/admin");
    expect(within(nav).getByRole("link", { name: "Mes anterior" })).toHaveAttribute(
      "href",
      "/admin?period=last-month",
    );
    expect(within(nav).getByRole("link", { name: "Este año" })).toHaveAttribute(
      "href",
      "/admin?period=this-year",
    );
    expect(within(nav).getByRole("link", { name: "Mes anterior" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(nav).getByRole("link", { name: "Este mes" })).not.toHaveAttribute("aria-current");
  });
});

describe("Resumen page: the figures", () => {
  beforeEach(() => {
    requireAdminMock.mockResolvedValue(ADMIN);
  });

  function stockBusyMonth() {
    readSummaryLedgerMock.mockResolvedValue(
      ledger({
        sales: [
          saleRow({ subtotal: 150_000, costOfGoods: 50_000 }),
          saleRow({
            date: new Date("2026-10-03T06:00:00Z"),
            subtotal: 50_000,
            costOfGoods: 10_000,
            costPending: true,
          }),
          // Voided: counts nowhere.
          saleRow({
            date: new Date("2026-10-04T06:00:00Z"),
            status: "void",
            subtotal: 900_000,
            costOfGoods: 1,
            costPending: true,
          }),
          // Last month: in the chart, not in this month's cards.
          saleRow({ date: new Date("2026-09-15T06:00:00Z"), subtotal: 7_000_000 }),
        ],
        purchases: [
          purchaseRow({ totalCost: 30_000 }),
          purchaseRow({ date: new Date("2026-09-10T06:00:00Z"), totalCost: 500_000 }),
        ],
      }),
    );
    listMaterialsMock.mockResolvedValue([
      { id: "m1", name: "Plata fina", stock: 10, avgCost: 1_800 },
    ]);
    listCatalogMock.mockResolvedValue({ products: pieces(2, 1), truncated: false });
    countUnreadMessagesMock.mockResolvedValue(3);
  }

  it("shows every KPI of the period", async () => {
    stockBusyMonth();

    await renderPage();

    const sales = card("Ventas");
    expect(within(sales).getByText("$2,000.00")).toBeInTheDocument();
    expect(within(sales).getByText("2 ventas")).toBeInTheDocument();

    expect(within(card("Costo de lo vendido")).getByText("$600.00")).toBeInTheDocument();

    const profit = card("Utilidad bruta");
    expect(within(profit).getByText("$1,400.00")).toBeInTheDocument();
    expect(within(profit).getByText("Margen 70.0 %")).toBeInTheDocument();

    const investments = card("Inversiones");
    expect(within(investments).getByText("$300.00")).toBeInTheDocument();
    expect(within(investments).getByText("1 compra")).toBeInTheDocument();

    // Flujo = ventas - inversiones = 2,000 - 300.
    expect(within(card("Flujo")).getByText("$1,700.00")).toBeInTheDocument();

    // 10 g at $18.00 a gram.
    expect(within(card("Valor del inventario")).getByText("$180.00")).toBeInTheDocument();

    expect(
      within(card("Piezas disponibles / vendidas")).getByText("2 / 1"),
    ).toBeInTheDocument();
    expect(within(card("Mensajes sin leer")).getByText("3")).toBeInTheDocument();
    // The voided sale's pending cost does not count: only the active one.
    expect(within(card("Ventas con costo pendiente")).getByText("1")).toBeInTheDocument();
  });

  it("links the unread messages to the inbox and the pending costs to Piezas", async () => {
    stockBusyMonth();

    await renderPage();

    expect(
      within(card("Mensajes sin leer")).getByRole("link", { name: "Ver mensajes" }),
    ).toHaveAttribute("href", "/admin/mensajes");
    expect(
      within(card("Ventas con costo pendiente")).getByRole("link", { name: "Registrar costos" }),
    ).toHaveAttribute("href", "/admin/piezas");
  });

  it("shows a loss in red, with its minus sign and the words, not the color alone", async () => {
    readSummaryLedgerMock.mockResolvedValue(
      ledger({ sales: [saleRow({ subtotal: 100_000, costOfGoods: 130_000 })] }),
    );

    await renderPage();

    const profit = card("Utilidad bruta");
    expect(within(profit).getByText("-$300.00")).toHaveClass("text-garnet");
    expect(within(profit).getByText("Margen -30.0 % · En pérdida")).toBeInTheDocument();
    // Only the profit is red.
    expect(within(card("Ventas")).getByText("$1,000.00")).not.toHaveClass("text-garnet");
  });

  it("shows a profit in the normal ink color", async () => {
    stockBusyMonth();

    await renderPage();

    const figure = within(card("Utilidad bruta")).getByText("$1,400.00");
    expect(figure).toHaveClass("text-ink");
    expect(figure).not.toHaveClass("text-garnet");
    expect(within(card("Utilidad bruta")).queryByText(/En pérdida/)).not.toBeInTheDocument();
  });

  it("shows no margin when nothing was sold", async () => {
    await renderPage();

    expect(within(card("Utilidad bruta")).getByText("Margen —")).toBeInTheDocument();
    expect(within(card("Ventas")).getByText("0 ventas")).toBeInTheDocument();
    expect(within(card("Ventas con costo pendiente")).getByText("0")).toBeInTheDocument();
  });

  describe("commissions", () => {
    it("shows the commissions and the profit after them: ventas - comisiones - costo de lo vendido", async () => {
      readSummaryLedgerMock.mockResolvedValue(
        ledger({
          sales: [
            // An online sale: Stripe's fee with the IVA on it.
            saleRow({ subtotal: 185_000, total: 200_000, shipping: 15_000, costOfGoods: 60_000, fee: 7_540 }),
            // A manual sale: the terminal's commission.
            saleRow({ subtotal: 90_000, total: 90_000, costOfGoods: 30_000, fee: 2_900 }),
          ],
        }),
      );

      await renderPage();

      expect(within(card("Comisiones Stripe")).getByText("$104.40")).toBeInTheDocument();
      // 2,750.00 - 104.40 - 900.00
      expect(
        within(card("Utilidad después de comisiones")).getByText("$1,745.60"),
      ).toBeInTheDocument();
      // The gross profit is untouched by the commissions.
      expect(within(card("Utilidad bruta")).getByText("$1,850.00")).toBeInTheDocument();
      expect(within(card("Ventas")).getByText("$2,750.00")).toBeInTheDocument();
    });

    it("is zero, and not pending, with nothing sold", async () => {
      await renderPage();

      expect(within(card("Comisiones Stripe")).getByText("$0.00")).toBeInTheDocument();
      expect(
        within(card("Utilidad después de comisiones")).getByText("$0.00"),
      ).toBeInTheDocument();
      expect(
        within(card("Comisiones Stripe")).queryByRole("link", { name: "Actualizar comisiones" }),
      ).not.toBeInTheDocument();
    });

    it("leaves Stripe test-mode sales out of every figure", async () => {
      readSummaryLedgerMock.mockResolvedValue(
        ledger({
          sales: [
            saleRow({ subtotal: 100_000, costOfGoods: 40_000, fee: 3_000 }),
            saleRow({
              livemode: false,
              subtotal: 900_000,
              costOfGoods: 500_000,
              costPending: true,
              fee: 70_000,
              feePending: true,
            }),
          ],
        }),
      );

      await renderPage();

      expect(within(card("Ventas")).getByText("$1,000.00")).toBeInTheDocument();
      expect(within(card("Ventas")).getByText("1 venta")).toBeInTheDocument();
      expect(within(card("Costo de lo vendido")).getByText("$400.00")).toBeInTheDocument();
      expect(within(card("Comisiones Stripe")).getByText("$30.00")).toBeInTheDocument();
      expect(
        within(card("Utilidad después de comisiones")).getByText("$570.00"),
      ).toBeInTheDocument();
      expect(within(card("Ventas con costo pendiente")).getByText("0")).toBeInTheDocument();
      expect(
        within(card("Comisiones Stripe")).queryByText(/comisión pendiente/),
      ).not.toBeInTheDocument();
      // Nor does it show up in the chart's October bar.
      expect(screen.getByTestId("chart-points").textContent).toContain(
        "2026-10|octubre de 2026|100000|0|60000",
      );
    });

    it("warns, and links to Ventas, when online sales still have their fee pending", async () => {
      readSummaryLedgerMock.mockResolvedValue(
        ledger({
          sales: [
            saleRow({ fee: 0, feePending: true }),
            saleRow({ fee: 0, feePending: true }),
            saleRow({ fee: 4_000 }),
          ],
        }),
      );

      await renderPage();

      const fees = within(card("Comisiones Stripe"));
      expect(fees.getByText("$40.00")).toBeInTheDocument();
      expect(
        fees.getByText(/2 ventas con comisión pendiente: la utilidad después de comisiones es mayor que la real/),
      ).toBeInTheDocument();
      expect(fees.getByRole("link", { name: "Actualizar comisiones" })).toHaveAttribute(
        "href",
        "/admin/ventas",
      );
    });

    it("uses the singular for one pending fee", async () => {
      readSummaryLedgerMock.mockResolvedValue(
        ledger({ sales: [saleRow({ fee: 0, feePending: true })] }),
      );

      await renderPage();

      expect(
        within(card("Comisiones Stripe")).getByText(/1 venta con comisión pendiente/),
      ).toBeInTheDocument();
    });

    it("shows a loss after commissions in red, with its minus sign and the words", async () => {
      readSummaryLedgerMock.mockResolvedValue(
        ledger({ sales: [saleRow({ subtotal: 100_000, costOfGoods: 98_000, fee: 5_000 })] }),
      );

      await renderPage();

      const after = card("Utilidad después de comisiones");
      expect(within(after).getByText("-$30.00")).toHaveClass("text-garnet");
      expect(
        within(after).getByText(/Ventas menos comisiones menos costo de lo vendido · En pérdida/),
      ).toBeInTheDocument();
      // The gross profit is still a profit: only the figure after commissions is red.
      expect(within(card("Utilidad bruta")).getByText("$20.00")).not.toHaveClass("text-garnet");
    });

    it("shows a profit after commissions in the normal ink color", async () => {
      stockBusyMonth();

      await renderPage();

      const figure = within(card("Utilidad después de comisiones")).getByText("$1,400.00");
      expect(figure).toHaveClass("text-ink");
      expect(
        within(card("Utilidad después de comisiones")).queryByText(/En pérdida/),
      ).not.toBeInTheDocument();
    });

    it("explains, in plain words, what a commission is and what the profit leaves out", async () => {
      await renderPage();

      expect(
        screen.getByText(
          /La comisión es lo que cobra Stripe por cada pago más el IVA de esa comisión/,
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/No incluye los impuestos de tus ventas \(IVA, ISR\): esos dependen de tu régimen fiscal/),
      ).toBeInTheDocument();
    });
  });

  it("keeps a negative cash flow visible", async () => {
    readSummaryLedgerMock.mockResolvedValue(
      ledger({ purchases: [purchaseRow({ totalCost: 250_000 })] }),
    );

    await renderPage();

    expect(within(card("Flujo")).getByText("-$2,500.00")).toBeInTheDocument();
  });

  it("explains gross profit and cash flow in plain words", async () => {
    await renderPage();

    expect(
      screen.getByText(/La utilidad bruta es lo que queda de tus ventas después de restar lo que costó hacer las piezas que vendiste\. El flujo es lo que vendiste menos lo que invertiste/),
    ).toBeInTheDocument();
  });

  it("hands the chart twelve months in Mexico time, from the same read as the cards", async () => {
    stockBusyMonth();

    await renderPage();

    const items = within(screen.getByTestId("chart-points")).getAllByRole("listitem");
    expect(items).toHaveLength(12);
    expect(items[0]).toHaveTextContent("2025-11|noviembre de 2025|0|0|0");
    // October: ventas 200_000, inversiones 30_000, utilidad 140_000 — the same
    // as the cards above it.
    expect(items[11]).toHaveTextContent("2026-10|octubre de 2026|200000|30000|140000");
    // September: 7_000_000 sold, 500_000 invested, minus the default 40_000 cost.
    expect(items[10]).toHaveTextContent("2026-09|septiembre de 2026|7000000|500000|6960000");
    expect(readSummaryLedgerMock).toHaveBeenCalledTimes(1);
  });

  it("offers the backup as a plain download link, with the privacy note", async () => {
    await renderPage();

    const link = screen.getByRole("link", { name: "Descargar respaldo" });
    expect(link).toHaveAttribute("href", "/admin/api/export");
    expect(
      screen.getByText("Contiene datos personales; guárdalo en un lugar seguro."),
    ).toBeInTheDocument();
  });

  it("shows no warning when everything was read in full", async () => {
    stockBusyMonth();

    await renderPage();

    expect(screen.queryByText("Datos parciales")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("Resumen page: partial data", () => {
  beforeEach(() => {
    requireAdminMock.mockResolvedValue(ADMIN);
  });

  it("warns 'Datos parciales' when the ledger read hit its cap", async () => {
    readSummaryLedgerMock.mockResolvedValue(
      ledger({ truncated: true, sales: [saleRow()] }),
    );

    await renderPage();

    const warning = screen.getByRole("status");
    expect(within(warning).getByText("Datos parciales")).toBeInTheDocument();
    expect(warning).toHaveTextContent(
      /Hay más ventas o compras de las que se pueden leer a la vez/,
    );
    // The figures are still shown (not hidden), but never as the whole truth.
    expect(within(card("Ventas")).getByText("$1,000.00")).toBeInTheDocument();
  });

  it("warns when the materials list reached its limit", async () => {
    listMaterialsMock.mockResolvedValue(
      Array.from({ length: 200 }, (_, index) => ({ id: `m${index}`, stock: 0, avgCost: 0 })),
    );

    await renderPage();

    expect(screen.getByText("Datos parciales")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Tienes 200 materiales o más: el valor del inventario puede ser menor al real.",
    );
  });

  it("does not warn for a materials list one short of its limit", async () => {
    listMaterialsMock.mockResolvedValue(
      Array.from({ length: 199 }, (_, index) => ({ id: `m${index}`, stock: 0, avgCost: 0 })),
    );

    await renderPage();

    expect(screen.queryByText("Datos parciales")).not.toBeInTheDocument();
  });

  it("warns when the catalog was cut", async () => {
    listCatalogMock.mockResolvedValue({ products: pieces(1, 1), truncated: true });

    await renderPage();

    expect(screen.getByText("Datos parciales")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "El catálogo tiene más de 500 piezas: los conteos de piezas son parciales.",
    );
  });

  it("lists every cut read in one warning", async () => {
    readSummaryLedgerMock.mockResolvedValue(ledger({ truncated: true }));
    listCatalogMock.mockResolvedValue({ products: [], truncated: true });

    await renderPage();

    const warning = screen.getByRole("status");
    expect(within(warning).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getAllByText("Datos parciales")).toHaveLength(1);
  });
});

describe("Resumen page: when a read fails", () => {
  beforeEach(() => {
    requireAdminMock.mockResolvedValue(ADMIN);
  });

  it.each([
    ["rejects", () => new Error("5 NOT_FOUND")],
    ["is not configured", () => null],
  ])("keeps the panel up and says what it could not load when every read %s", async (_label, outcome) => {
    for (const mock of DATA_MOCKS) {
      const result = outcome();
      if (result === null) {
        mock.mockResolvedValue(null);
      } else {
        mock.mockRejectedValue(result);
      }
    }

    await expect(renderPage()).resolves.toBeUndefined();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "No pudimos cargar las ventas y las inversiones, el inventario, las piezas y los mensajes. Recarga la página e inténtalo de nuevo.",
    );
    expect(within(card("Ventas")).getByText("—")).toBeInTheDocument();
    expect(within(card("Flujo")).getByText("—")).toBeInTheDocument();
    expect(within(card("Valor del inventario")).getByText("—")).toBeInTheDocument();
    expect(within(card("Piezas disponibles / vendidas")).getByText("—")).toBeInTheDocument();
    expect(within(card("Mensajes sin leer")).getByText("—")).toBeInTheDocument();
    expect(screen.getByText("No pudimos calcular la gráfica.")).toBeInTheDocument();
    expect(screen.queryByTestId("chart-points")).not.toBeInTheDocument();
  });

  it("still shows what could be read when only one read fails", async () => {
    readSummaryLedgerMock.mockResolvedValue(ledger({ sales: [saleRow()] }));
    countUnreadMessagesMock.mockRejectedValue(new Error("14 UNAVAILABLE"));

    await renderPage();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "No pudimos cargar los mensajes. Recarga la página e inténtalo de nuevo.",
    );
    expect(within(card("Ventas")).getByText("$1,000.00")).toBeInTheDocument();
    expect(within(card("Mensajes sin leer")).getByText("—")).toBeInTheDocument();
  });
});
