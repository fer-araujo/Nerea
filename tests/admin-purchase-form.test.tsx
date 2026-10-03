// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

// The Server Action is mocked: this file covers what the form island adds on
// top of it — the item rows, the live total, and the typed result. The
// action's own behavior (authorization first, zod validation, transactions)
// is in tests/admin-inventory-actions.test.ts.
const purchaseActionMock = vi.fn();
vi.mock("@/app/admin/(panel)/inversiones/actions", () => ({
  recordPurchaseAction: (...args: unknown[]) => purchaseActionMock(...args),
}));

import { MAX_PURCHASE_ITEMS } from "@/lib/admin/domain/inventory";
import {
  PurchaseForm,
  type PurchaseMaterial,
} from "../app/admin/(panel)/inversiones/PurchaseForm";

const TODAY = "2026-10-02";
const MATERIALS: PurchaseMaterial[] = [
  { id: "silver", name: "Plata fina", unit: "g" },
  { id: "stones", name: "Circones", unit: "pz" },
];

const addButton = () => screen.getByRole("button", { name: "+ Agregar otro material" });
const submitButton = () => screen.getByRole("button", { name: "Registrar compra" });
const rowsCount = () => screen.getAllByRole("group").length;

function fillRow(
  index: number,
  { material, qty, cost }: { material: string; qty: string; cost: string },
) {
  const group = within(screen.getAllByRole("group")[index]);
  fireEvent.change(group.getByLabelText("Material"), { target: { value: material } });
  fireEvent.change(group.getByLabelText(/^Cantidad/), { target: { value: qty } });
  fireEvent.change(group.getByLabelText("Costo total (MXN)"), { target: { value: cost } });
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("PurchaseForm: item rows", () => {
  it("starts with one row and a date of today", () => {
    render(<PurchaseForm materials={MATERIALS} today={TODAY} />);

    expect(rowsCount()).toBe(1);
    expect(screen.getByLabelText("Fecha")).toHaveValue(TODAY);
    expect(screen.getByLabelText("Fecha")).toHaveAttribute("max", TODAY);
  });

  it("adds and removes rows, but never removes the last one", () => {
    render(<PurchaseForm materials={MATERIALS} today={TODAY} />);
    expect(screen.getByRole("button", { name: "Quitar material 1" })).toBeDisabled();

    fireEvent.click(addButton());
    fireEvent.click(addButton());
    expect(rowsCount()).toBe(3);

    fireEvent.click(screen.getByRole("button", { name: "Quitar material 2" }));
    expect(rowsCount()).toBe(2);
    expect(screen.getByRole("button", { name: "Quitar material 1" })).toBeEnabled();
  });

  it("keeps each row's values when another row is removed", () => {
    render(<PurchaseForm materials={MATERIALS} today={TODAY} />);
    fireEvent.click(addButton());
    fireEvent.click(addButton());
    fillRow(0, { material: "silver", qty: "1", cost: "10" });
    fillRow(1, { material: "stones", qty: "2", cost: "20" });
    fillRow(2, { material: "silver", qty: "3", cost: "30" });

    fireEvent.click(screen.getByRole("button", { name: "Quitar material 2" }));

    const groups = screen.getAllByRole("group");
    expect(within(groups[0]).getByLabelText(/^Cantidad/)).toHaveValue(1);
    expect(within(groups[1]).getByLabelText(/^Cantidad/)).toHaveValue(3);
    expect(within(groups[1]).getByLabelText("Costo total (MXN)")).toHaveValue(30);
  });

  it(`stops at ${MAX_PURCHASE_ITEMS} rows, the most one transaction carries`, () => {
    render(<PurchaseForm materials={MATERIALS} today={TODAY} />);

    for (let index = 1; index < MAX_PURCHASE_ITEMS; index += 1) {
      fireEvent.click(addButton());
    }

    expect(rowsCount()).toBe(MAX_PURCHASE_ITEMS);
    expect(addButton()).toBeDisabled();
  });

  it("shows the unit of the chosen material in the quantity label", () => {
    render(<PurchaseForm materials={MATERIALS} today={TODAY} />);
    const group = within(screen.getAllByRole("group")[0]);
    expect(group.getByText("Cantidad")).toBeInTheDocument();

    fireEvent.change(group.getByLabelText("Material"), { target: { value: "silver" } });
    expect(group.getByText("Cantidad (g)")).toBeInTheDocument();

    fireEvent.change(group.getByLabelText("Material"), { target: { value: "stones" } });
    expect(group.getByText("Cantidad (pz)")).toBeInTheDocument();
  });

  it("fills the supplier with «Inventario inicial» in one click", () => {
    render(<PurchaseForm materials={MATERIALS} today={TODAY} />);

    fireEvent.click(screen.getByRole("button", { name: "Usar «Inventario inicial»" }));

    expect(screen.getByLabelText("Proveedor o concepto")).toHaveValue("Inventario inicial");
  });

  it("explains how to load the opening inventory", () => {
    render(<PurchaseForm materials={MATERIALS} today={TODAY} />);

    expect(
      screen.getByText(/llamada «Inventario inicial» con su costo/),
    ).toBeInTheDocument();
  });
});

describe("PurchaseForm: live total", () => {
  it("starts at zero and sums the valid costs of every row", () => {
    render(<PurchaseForm materials={MATERIALS} today={TODAY} />);
    const total = () => screen.getByText("Total de la compra").parentElement;
    expect(total()).toHaveTextContent("$0.00");

    fireEvent.click(addButton());
    fillRow(0, { material: "silver", qty: "5", cost: "90.00" });
    fillRow(1, { material: "stones", qty: "3", cost: "20.5" });

    expect(total()).toHaveTextContent("$110.50");
  });

  it("ignores a cost that is not yet a valid amount instead of showing garbage", () => {
    render(<PurchaseForm materials={MATERIALS} today={TODAY} />);

    fillRow(0, { material: "silver", qty: "1", cost: "12.345" });

    expect(screen.getByText("Total de la compra").parentElement).toHaveTextContent("$0.00");
  });
});

describe("PurchaseForm: submitting", () => {
  function fillValidPurchase() {
    fireEvent.click(addButton());
    fireEvent.change(screen.getByLabelText("Proveedor o concepto"), {
      target: { value: "Proveedor Uno" },
    });
    fireEvent.change(screen.getByLabelText("Nota (opcional)"), {
      target: { value: "Factura 12" },
    });
    fillRow(0, { material: "silver", qty: "5", cost: "90.00" });
    fillRow(1, { material: "stones", qty: "3", cost: "20" });
  }

  it("posts one value per row for each repeated field, plus the header fields", async () => {
    purchaseActionMock.mockResolvedValue({ ok: true });
    render(<PurchaseForm materials={MATERIALS} today={TODAY} />);
    fillValidPurchase();

    fireEvent.click(submitButton());

    await waitFor(() => expect(purchaseActionMock).toHaveBeenCalledTimes(1));
    const [formData] = purchaseActionMock.mock.calls[0] as [FormData];
    expect(formData.get("date")).toBe(TODAY);
    expect(formData.get("supplier")).toBe("Proveedor Uno");
    expect(formData.get("note")).toBe("Factura 12");
    expect(formData.getAll("itemMaterialId")).toEqual(["silver", "stones"]);
    expect(formData.getAll("itemQty")).toEqual(["5", "3"]);
    expect(formData.getAll("itemCost")).toEqual(["90.00", "20"]);
  });

  it("confirms success and clears the form back to one empty row", async () => {
    purchaseActionMock.mockResolvedValue({ ok: true });
    render(<PurchaseForm materials={MATERIALS} today={TODAY} />);
    fillValidPurchase();

    fireEvent.click(submitButton());

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Compra registrada. Las existencias y el costo promedio se actualizaron.",
    );
    expect(rowsCount()).toBe(1);
    const group = within(screen.getAllByRole("group")[0]);
    expect(group.getByLabelText("Material")).toHaveValue("");
    expect(group.getByLabelText(/^Cantidad/)).toHaveValue(null);
    expect(screen.getByLabelText("Proveedor o concepto")).toHaveValue("");
    expect(screen.getByLabelText("Nota (opcional)")).toHaveValue("");
    expect(screen.getByText("Total de la compra").parentElement).toHaveTextContent("$0.00");
  });

  it("shows the server's message and KEEPS what was typed when it fails", async () => {
    purchaseActionMock.mockResolvedValue({
      ok: false,
      error: "invalid",
      message: "Costo: escribe un monto válido en pesos (máximo 2 decimales).",
    });
    render(<PurchaseForm materials={MATERIALS} today={TODAY} />);
    fillValidPurchase();

    fireEvent.click(submitButton());

    expect(await screen.findByRole("alert")).toHaveTextContent("Costo: escribe un monto válido");
    expect(rowsCount()).toBe(2);
    expect(screen.getByLabelText("Proveedor o concepto")).toHaveValue("Proveedor Uno");
    expect(within(screen.getAllByRole("group")[1]).getByLabelText("Costo total (MXN)")).toHaveValue(20);
    await waitFor(() => expect(submitButton()).toBeEnabled());
  });

  it("shows a generic message when the request itself fails, without leaking its error", async () => {
    purchaseActionMock.mockRejectedValue(new Error("network down"));
    render(<PurchaseForm materials={MATERIALS} today={TODAY} />);
    fillValidPurchase();

    fireEvent.click(submitButton());

    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo guardar");
    expect(screen.getByRole("alert")).not.toHaveTextContent("network down");
  });

  it("disables the form while the purchase is being recorded, so it cannot be double-submitted", async () => {
    let finish: (value: { ok: true }) => void = () => undefined;
    purchaseActionMock.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    render(<PurchaseForm materials={MATERIALS} today={TODAY} />);
    fillValidPurchase();

    fireEvent.click(submitButton());

    expect(await screen.findByRole("button", { name: "Registrando…" })).toBeDisabled();
    fireEvent.submit(screen.getByRole("button", { name: "Registrando…" }).closest("form") as HTMLFormElement);
    expect(purchaseActionMock).toHaveBeenCalledTimes(1);

    finish({ ok: true });
    expect(await screen.findByRole("status")).toBeInTheDocument();
  });
});
