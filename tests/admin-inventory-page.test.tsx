// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// The unified Inventario page: two views (Materiales, Compras) and every form
// in a modal. The data layer and the Server Actions are mocked; what is covered
// here is the page itself — the tabs, the buttons, what each modal opens with,
// that a successful submit closes it, and the opening-stock badge. The data
// rules are in tests/admin-materials-data.test.ts and friends; the guards are
// in tests/admin-modules-page-guards.test.ts.
vi.mock("server-only", () => ({}));

const requireAdminMock = vi.fn();
vi.mock("@/lib/admin/auth/session", () => ({
  requireAdmin: (...args: unknown[]) => requireAdminMock(...args),
}));

const listMaterialsMock = vi.fn();
const listMovementsMock = vi.fn();
vi.mock("@/lib/admin/data/materials", () => ({
  listMaterials: (...args: unknown[]) => listMaterialsMock(...args),
  listMovements: (...args: unknown[]) => listMovementsMock(...args),
}));

const listPurchasesMock = vi.fn();
const sumPurchasesMock = vi.fn();
vi.mock("@/lib/admin/data/purchases", () => ({
  PURCHASE_SUM_LIMIT: 2000,
  listPurchases: (...args: unknown[]) => listPurchasesMock(...args),
  sumPurchases: (...args: unknown[]) => sumPurchasesMock(...args),
}));

const createActionMock = vi.fn();
const adjustActionMock = vi.fn();
const correctActionMock = vi.fn();
const purchaseActionMock = vi.fn();
vi.mock("@/app/admin/(panel)/inventario/actions", () => ({
  createMaterialAction: (...args: unknown[]) => createActionMock(...args),
  adjustStockAction: (...args: unknown[]) => adjustActionMock(...args),
  correctStockAction: (...args: unknown[]) => correctActionMock(...args),
  recordPurchaseAction: (...args: unknown[]) => purchaseActionMock(...args),
}));

const replaceMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock }),
}));

import AdminInventoryPage from "@/app/admin/(panel)/inventario/page";

beforeAll(() => {
  // jsdom ships an empty HTMLDialogElement; see tests/admin-modal.test.tsx.
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    if (!this.hasAttribute("open")) return;
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});

const ADMIN = { uid: "uid-1", email: "admin@example.com" };

const PLATA = {
  id: "m1",
  name: "Plata fina",
  kind: "fine_silver" as const,
  unit: "g" as const,
  stock: 30,
  avgCost: 3333,
  createdAt: null,
  updatedAt: null,
};
const CIRCONES = {
  id: "m2",
  name: "Circones",
  kind: "stone" as const,
  unit: "pz" as const,
  stock: 12,
  avgCost: 500,
  createdAt: null,
  updatedAt: null,
};

beforeEach(() => {
  vi.resetAllMocks();
  requireAdminMock.mockResolvedValue(ADMIN);
  listMaterialsMock.mockResolvedValue([PLATA, CIRCONES]);
  listMovementsMock.mockResolvedValue({ movements: [], hasNextPage: false });
  listPurchasesMock.mockResolvedValue({ purchases: [], hasNextPage: false });
  sumPurchasesMock.mockResolvedValue({
    totalCost: 0,
    count: 0,
    initialCount: 0,
    truncated: false,
  });
  // 2026-10-02 12:00 in Mexico City.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-02T18:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

type Search = Record<string, string>;

async function renderPage(search: Search = {}) {
  return render(await AdminInventoryPage({ searchParams: Promise.resolve(search) }));
}

const dialogs = () => Array.from(document.querySelectorAll("dialog"));
const openDialog = () => dialogs().find((dialog) => dialog.hasAttribute("open"));
const viewTabs = () => screen.getByRole("navigation", { name: "Vista del inventario" });

describe("Inventario: the two views", () => {
  it("is one page with a Materiales tab and a Compras tab, Materiales by default", async () => {
    await renderPage();

    expect(screen.getByRole("heading", { level: 1, name: "Inventario" })).toBeInTheDocument();
    const links = within(viewTabs()).getAllByRole("link");
    expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Materiales", "/admin/inventario?vista=materiales"],
      ["Compras", "/admin/inventario?vista=compras"],
    ]);
    expect(within(viewTabs()).getByRole("link", { name: "Materiales" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(viewTabs()).getByRole("link", { name: "Compras" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("shares the tab styling of the panel: one scrolling row that never grows a vertical scrollbar", async () => {
    await renderPage();

    expect(viewTabs()).toHaveClass(
      "overflow-x-auto",
      "overflow-y-hidden",
      "[scrollbar-width:none]",
      "[&::-webkit-scrollbar]:hidden",
    );
    for (const link of within(viewTabs()).getAllByRole("link")) {
      expect(link).toHaveClass("border-b-2", "focus-visible:-outline-offset-2!");
    }
  });

  it("marks Compras as current on ?vista=compras", async () => {
    await renderPage({ vista: "compras" });

    expect(within(viewTabs()).getByRole("link", { name: "Compras" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(viewTabs()).getByRole("link", { name: "Materiales" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("falls back to Materiales for an unknown view", async () => {
    await renderPage({ vista: "otra-cosa" });

    expect(within(viewTabs()).getByRole("link", { name: "Materiales" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("button", { name: "Nuevo material" })).toBeInTheDocument();
  });
});

describe("Inventario · Materiales", () => {
  it("lists each material with its kind, stock, average cost and value, and totals the inventory", async () => {
    await renderPage();

    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row");
    // header, two materials, footer
    expect(rows).toHaveLength(4);
    expect(rows[1]).toHaveTextContent("Plata fina");
    expect(rows[1]).toHaveTextContent("30.00 g");
    expect(rows[1]).toHaveTextContent("$33.33 / g");
    expect(rows[1]).toHaveTextContent("$999.90");
    expect(rows[2]).toHaveTextContent("Circones");
    expect(rows[2]).toHaveTextContent("12 pz");
    expect(rows[2]).toHaveTextContent("$5.00 / pz");
    expect(rows[2]).toHaveTextContent("$60.00");
    // 999.90 + 60.00
    expect(rows[3]).toHaveTextContent("Valor del inventario$1,059.90");
  });

  it("gives every row its four actions, named by the material they act on", async () => {
    await renderPage();

    for (const name of ["Plata fina", "Circones"]) {
      expect(screen.getByRole("button", { name: `Registrar compra de ${name}` })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: `Ajustar ${name}` })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: `Corregir ${name}` })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: `Ver historial de ${name}` })).toBeInTheDocument();
    }
    expect(screen.getByRole("link", { name: "Ver historial de Plata fina" })).toHaveAttribute(
      "href",
      "/admin/inventario?vista=materiales&material=m1",
    );
  });

  it("starts with every modal closed and no form in the page", async () => {
    await renderPage();

    expect(openDialog()).toBeUndefined();
    expect(screen.queryByLabelText("Nombre")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Motivo")).not.toBeInTheDocument();
  });

  it("opens 'Nuevo material' in a modal with the opening-stock fields", async () => {
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Nuevo material" }));

    const dialog = screen.getByRole("dialog", { name: "Nuevo material" });
    expect(within(dialog).getByLabelText("Nombre")).toHaveFocus();
    expect(within(dialog).getByLabelText("Cantidad inicial (g)")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Costo total (MXN)")).toBeInTheDocument();
  });

  it("closes the modal when the material is created, and gives the focus back to the button", async () => {
    createActionMock.mockResolvedValue({ ok: true });
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Nuevo material" }));
    const dialog = screen.getByRole("dialog", { name: "Nuevo material" });
    fireEvent.change(within(dialog).getByLabelText("Nombre"), { target: { value: "Plata" } });

    fireEvent.click(within(dialog).getByRole("button", { name: "Crear material" }));

    await waitFor(() => expect(openDialog()).toBeUndefined());
    expect(createActionMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Nuevo material" })).toHaveFocus();
  });

  it("keeps the modal open, with the message, when the action refuses", async () => {
    createActionMock.mockResolvedValue({
      ok: false,
      error: "invalid",
      message: "Costo total: escribe cuánto costó lo que ya tienes (puede ser 0).",
    });
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Nuevo material" }));
    const dialog = screen.getByRole("dialog", { name: "Nuevo material" });
    fireEvent.change(within(dialog).getByLabelText("Nombre"), { target: { value: "Plata" } });

    fireEvent.click(within(dialog).getByRole("button", { name: "Crear material" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Costo total");
    expect(openDialog()).toBe(dialog);
  });

  it("'Registrar compra' opens the purchase modal with THAT material already chosen", async () => {
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Registrar compra de Circones" }));

    const dialog = screen.getByRole("dialog", { name: "Registrar compra" });
    expect(dialog).toHaveAccessibleDescription("Circones");
    expect(within(dialog).getByLabelText("Material")).toHaveValue("m2");
    // The other materials are still on offer for a multi-item purchase.
    expect(
      within(within(dialog).getByLabelText("Material")).getAllByRole("option").map((o) => o.textContent),
    ).toEqual(["Elige un material", "Plata fina", "Circones"]);
  });

  it("closes the purchase modal on success and returns the focus to the row's button", async () => {
    purchaseActionMock.mockResolvedValue({ ok: true });
    await renderPage();
    const opener = screen.getByRole("button", { name: "Registrar compra de Plata fina" });
    fireEvent.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Registrar compra" });
    fireEvent.change(within(dialog).getByLabelText(/^Cantidad/), { target: { value: "10" } });
    fireEvent.change(within(dialog).getByLabelText("Costo total (MXN)"), { target: { value: "500" } });

    fireEvent.click(within(dialog).getByRole("button", { name: "Registrar compra" }));

    await waitFor(() => expect(openDialog()).toBeUndefined());
    expect(purchaseActionMock).toHaveBeenCalledTimes(1);
    expect(opener).toHaveFocus();
  });

  it("'Ajustar' opens the adjustment for that material, with the current figures and the hint", async () => {
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Ajustar Plata fina" }));

    const dialog = screen.getByRole("dialog", { name: "Ajustar existencias" });
    expect(dialog).toHaveAccessibleDescription("Plata fina");
    expect(within(dialog).getByText(/Ahora hay 30\.00 g a \$33\.33 \/ g/)).toBeInTheDocument();
    expect(within(dialog).getByText(/¿Compraste material\? Usa Registrar compra\./)).toBeInTheDocument();
    expect(
      within(within(dialog).getByLabelText("Tipo")).getAllByRole("option").map((o) => o.textContent),
    ).toEqual(["Conteo físico (suma o resta)", "Merma / pérdida (solo resta)"]);
  });

  it("'Corregir' opens the correction prefilled with the current stock and average", async () => {
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Corregir Plata fina" }));

    const dialog = screen.getByRole("dialog", { name: "Corregir existencias y costo" });
    expect(dialog).toHaveAccessibleDescription("Plata fina");
    expect(within(dialog).getByLabelText(/^Existencias reales/)).toHaveValue(30);
    expect(within(dialog).getByLabelText(/^Costo promedio real/)).toHaveValue(33.33);
    expect(within(dialog).getByLabelText("Motivo")).toBeRequired();
  });

  it("opens each row's modal for the right material, one at a time", async () => {
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Corregir Circones" }));
    expect(
      within(screen.getByRole("dialog", { name: "Corregir existencias y costo" })).getByLabelText(
        /^Existencias reales \(pz\)/,
      ),
    ).toHaveValue(12);
    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(openDialog()).toBeUndefined();

    fireEvent.click(screen.getByRole("button", { name: "Corregir Plata fina" }));
    expect(
      within(screen.getByRole("dialog", { name: "Corregir existencias y costo" })).getByLabelText(
        /^Existencias reales \(g\)/,
      ),
    ).toHaveValue(30);
  });

  it("shows an empty state that points to Nuevo material", async () => {
    listMaterialsMock.mockResolvedValue([]);
    await renderPage();

    expect(screen.getByText("Aún no hay materiales")).toBeInTheDocument();
    expect(screen.getByText(/Crea tu primer material con «Nuevo material»/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nuevo material" })).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("says so, without crashing, when the materials cannot be read", async () => {
    listMaterialsMock.mockRejectedValue(new Error("5 NOT_FOUND"));
    await renderPage();

    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos cargar el inventario");
    expect(screen.queryByRole("button", { name: "Nuevo material" })).not.toBeInTheDocument();
  });
});

describe("Inventario · Historial (a modal)", () => {
  const MOVEMENTS = [
    {
      id: "mv2",
      type: "correction" as const,
      qty: -30,
      unitCost: 3333,
      totalCost: 99_990,
      refId: null,
      note: "Error al capturar",
      createdAt: new Date("2026-10-02T18:00:00Z"),
    },
    {
      id: "mv1",
      type: "purchase" as const,
      qty: 60,
      unitCost: 1667,
      totalCost: 100_020,
      refId: "p1",
      note: null,
      createdAt: new Date("2026-10-01T18:00:00Z"),
    },
  ];

  it("opens, already open, over the materials when a material is selected", async () => {
    listMovementsMock.mockResolvedValue({ movements: MOVEMENTS, hasNextPage: false });
    await renderPage({ material: "m1" });

    const dialog = screen.getByRole("dialog", { name: "Historial · Plata fina" });
    expect(dialog).toBe(openDialog());
    expect(listMovementsMock).toHaveBeenCalledWith("m1", 1);
    const items = within(dialog).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Corrección");
    expect(items[0]).toHaveTextContent("−30.00 g");
    expect(items[0]).toHaveTextContent("$33.33 / g");
    expect(items[0]).toHaveTextContent("Error al capturar");
    expect(items[1]).toHaveTextContent("Compra");
    expect(items[1]).toHaveTextContent("+60.00 g");
  });

  it("shows a correction that only changed the cost without a misleading sign", async () => {
    listMovementsMock.mockResolvedValue({
      movements: [{ ...MOVEMENTS[0], qty: 0, totalCost: 0 }],
      hasNextPage: false,
    });
    await renderPage({ material: "m1" });

    const item = within(screen.getByRole("dialog")).getAllByRole("listitem")[0];
    expect(item).toHaveTextContent("0.00 g");
    expect(item).not.toHaveTextContent("−0.00");
    expect(item).not.toHaveTextContent("+0.00");
  });

  it("pages inside the modal with links that keep the material", async () => {
    listMovementsMock.mockResolvedValue({ movements: MOVEMENTS, hasNextPage: true });
    await renderPage({ material: "m1", page: "2" });

    const pager = screen.getByRole("navigation", { name: "Paginación del historial" });
    expect(within(pager).getByRole("link", { name: /Más recientes/ })).toHaveAttribute(
      "href",
      "/admin/inventario?vista=materiales&material=m1",
    );
    expect(within(pager).getByRole("link", { name: /Más antiguos/ })).toHaveAttribute(
      "href",
      "/admin/inventario?vista=materiales&material=m1&page=3",
    );
  });

  it("closing it goes back to the materials without the selection, and returns the focus to its link", async () => {
    await renderPage({ material: "m1" });
    const dialog = screen.getByRole("dialog", { name: "Historial · Plata fina" });

    fireEvent.click(within(dialog).getByRole("button", { name: "Cerrar" }));

    expect(replaceMock).toHaveBeenCalledWith("/admin/inventario?vista=materiales", {
      scroll: false,
    });
    expect(screen.getByRole("link", { name: "Ver historial de Plata fina" })).toHaveFocus();
  });

  it("also reports Esc, the native close, by leaving the selection", async () => {
    await renderPage({ material: "m1" });

    act(() => (openDialog() as HTMLDialogElement).close());

    expect(replaceMock).toHaveBeenCalledWith("/admin/inventario?vista=materiales", {
      scroll: false,
    });
  });

  it("explains an empty history inside the modal", async () => {
    await renderPage({ material: "m1" });
    expect(within(screen.getByRole("dialog")).getByText("Sin movimientos todavía")).toBeInTheDocument();
  });

  it("says so when the history cannot be read", async () => {
    listMovementsMock.mockRejectedValue(new Error("5 NOT_FOUND"));
    await renderPage({ material: "m1" });

    expect(within(screen.getByRole("dialog")).getByRole("alert")).toHaveTextContent(
      "No pudimos cargar el historial",
    );
  });

  it("opens no modal for a material that does not exist", async () => {
    await renderPage({ material: "ghost" });

    expect(openDialog()).toBeUndefined();
    expect(screen.getByRole("alert")).toHaveTextContent("No encontramos ese material.");
  });
});

describe("Inventario · Compras", () => {
  const BOUGHT = {
    id: "p1",
    date: new Date("2026-10-02T06:00:00Z"),
    supplier: "Proveedor Uno",
    note: "Factura 12",
    items: [{ materialId: "m1", materialName: "Plata fina", qty: 5, totalCost: 9000 }],
    totalCost: 9000,
    initial: false,
  };
  const OPENING = {
    id: "p2",
    date: new Date("2026-10-02T06:00:00Z"),
    supplier: "Inventario inicial",
    note: null,
    items: [{ materialId: "m2", materialName: "Circones", qty: 12, totalCost: 6000 }],
    totalCost: 6000,
    initial: true,
  };

  it("shows the period total with the shared period tabs, and the count", async () => {
    sumPurchasesMock.mockResolvedValue({
      totalCost: 9000,
      count: 1,
      initialCount: 0,
      truncated: false,
    });
    listPurchasesMock.mockResolvedValue({ purchases: [BOUGHT], hasNextPage: false });
    await renderPage({ vista: "compras" });

    expect(screen.getByText(/Total invertido · octubre de 2026/)).toBeInTheDocument();
    expect(screen.getByText("$90.00", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByText("1 compra")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Periodo" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Proveedor Uno" })).toBeInTheDocument();
    expect(screen.getByText("Factura 12")).toBeInTheDocument();
    expect(screen.getByText(/Plata fina · 5\.00 g/)).toBeInTheDocument();
  });

  it("flags an opening-stock purchase with an 'Inventario inicial' badge, and says it is not an investment", async () => {
    sumPurchasesMock.mockResolvedValue({
      totalCost: 9000,
      count: 1,
      initialCount: 1,
      truncated: false,
    });
    listPurchasesMock.mockResolvedValue({ purchases: [BOUGHT, OPENING], hasNextPage: false });
    await renderPage({ vista: "compras" });

    const items = screen.getAllByRole("listitem").filter((item) => item.querySelector("h3"));
    expect(items).toHaveLength(2);
    // The ordinary purchase carries no badge...
    expect(within(items[0]).queryByText("Inventario inicial")).not.toBeInTheDocument();
    // ...the opening stock does, and is named after what it opened.
    expect(within(items[1]).getByText("Inventario inicial")).toBeInTheDocument();
    expect(within(items[1]).getByRole("heading")).toHaveTextContent("Circones");
    // It still shows its own amount, but the period total above does not include it.
    expect(items[1]).toHaveTextContent("$60.00");
    expect(screen.getByText("$90.00", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByText(/no cuenta como inversión del periodo/)).toBeInTheDocument();
  });

  it("does not mention opening stock when the period has none", async () => {
    await renderPage({ vista: "compras" });

    expect(screen.queryByText(/no cuenta como inversión/)).not.toBeInTheDocument();
  });

  it("opens 'Registrar compra' in a modal with the multi-item form and returns the focus on success", async () => {
    purchaseActionMock.mockResolvedValue({ ok: true });
    await renderPage({ vista: "compras" });
    const opener = screen.getByRole("button", { name: "Registrar compra" });

    fireEvent.click(opener);

    const dialog = screen.getByRole("dialog", { name: "Registrar compra" });
    expect(within(dialog).getByRole("button", { name: "+ Agregar otro material" })).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Material")).toHaveValue("");

    fireEvent.change(within(dialog).getByLabelText("Material"), { target: { value: "m1" } });
    fireEvent.change(within(dialog).getByLabelText(/^Cantidad/), { target: { value: "5" } });
    fireEvent.change(within(dialog).getByLabelText("Costo total (MXN)"), { target: { value: "90" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Registrar compra" }));

    await waitFor(() => expect(openDialog()).toBeUndefined());
    expect(opener).toHaveFocus();
  });

  it("asks to create materials first when there are none", async () => {
    listMaterialsMock.mockResolvedValue([]);
    await renderPage({ vista: "compras" });

    expect(screen.queryByRole("button", { name: "Registrar compra" })).not.toBeInTheDocument();
    // The tab, and the link in the explanation.
    expect(screen.getAllByRole("link", { name: "Materiales" })).toHaveLength(2);
    expect(screen.getByText(/Primero crea tus materiales/)).toBeInTheDocument();
  });

  it("pages with links that keep the view and the period", async () => {
    listPurchasesMock.mockResolvedValue({ purchases: [BOUGHT], hasNextPage: true });
    await renderPage({ vista: "compras", period: "last-month", page: "2" });

    const pager = screen.getByRole("navigation", { name: "Paginación de compras" });
    expect(within(pager).getByRole("link", { name: /Más recientes/ })).toHaveAttribute(
      "href",
      "/admin/inventario?vista=compras&period=last-month",
    );
    expect(within(pager).getByRole("link", { name: /Más antiguos/ })).toHaveAttribute(
      "href",
      "/admin/inventario?vista=compras&period=last-month&page=3",
    );
  });

  it("says so, without crashing, when the purchases or the total cannot be read", async () => {
    listPurchasesMock.mockRejectedValue(new Error("5 NOT_FOUND"));
    sumPurchasesMock.mockRejectedValue(new Error("5 NOT_FOUND"));
    await renderPage({ vista: "compras" });

    expect(screen.getByText("No pudimos calcular el total.")).toBeInTheDocument();
    expect(screen.getByText(/No pudimos cargar las compras/)).toBeInTheDocument();
  });
});
