// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

// The Server Actions are mocked: this file covers what the form islands add on
// top of them — piece rows, catalog prices as a starting point, the live
// total, the confirmation before voiding and the typed results. The actions'
// own behavior (authorization first, zod validation, the writes, the store
// warning) is in tests/admin-pieces-sales-actions.test.ts.
const recordActionMock = vi.fn();
const voidActionMock = vi.fn();
const refreshActionMock = vi.fn();
vi.mock("@/app/admin/(panel)/ventas/actions", () => ({
  recordManualSaleAction: (...args: unknown[]) => recordActionMock(...args),
  voidSaleAction: (...args: unknown[]) => voidActionMock(...args),
  refreshSaleFeeAction: (...args: unknown[]) => refreshActionMock(...args),
}));

import { MAX_SALE_ITEMS } from "@/lib/admin/domain/sales";
import {
  ManualSaleForm,
  type SalePiece,
} from "../app/admin/(panel)/ventas/ManualSaleForm";
import { RefreshFeeForm } from "../app/admin/(panel)/ventas/RefreshFeeForm";
import { VoidSaleForm } from "../app/admin/(panel)/ventas/VoidSaleForm";

const TODAY = "2026-10-02";
// The ring is a design made in several copies (3 in stock); the others are
// one-of-one pieces.
const PIECES: SalePiece[] = [
  { handle: "anillo-luna", title: "Anillo Luna", price: 185_000, stock: 3 },
  { handle: "aretes-sol", title: "Aretes Sol", price: 90_000, stock: 1 },
  { handle: "dije-mar", title: "Dije Mar", price: 120_050, stock: 1 },
];

const addButton = () => screen.getByRole("button", { name: "+ Agregar otra pieza" });
const submitButton = () => screen.getByRole("button", { name: "Registrar venta" });
const rows = () => screen.getAllByRole("group");
const total = () => screen.getByText("Total de la venta").parentElement;
const subtotal = () => screen.getByText("Piezas").parentElement;

function chooseRow(index: number, handle: string) {
  const group = within(rows()[index]);
  fireEvent.change(group.getByLabelText("Pieza"), { target: { value: handle } });
}

function quantityOf(index: number) {
  return within(rows()[index]).getByLabelText("Cantidad");
}

function priceOf(index: number) {
  return within(rows()[index]).getByLabelText("Precio por pieza (MXN)");
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("ManualSaleForm: the piece rows", () => {
  it("starts with one row, a date of today that cannot be in the future, and 'Descontar de la tienda' on", () => {
    render(<ManualSaleForm pieces={PIECES} today={TODAY} />);

    expect(rows()).toHaveLength(1);
    expect(screen.getByLabelText("Fecha")).toHaveValue(TODAY);
    expect(screen.getByLabelText("Fecha")).toHaveAttribute("max", TODAY);
    expect(screen.getByLabelText("Descontar de la tienda")).toBeChecked();
    expect(quantityOf(0)).toHaveValue(1);
  });

  it("starts the price at the catalog's, in pesos, when a piece is chosen", () => {
    render(<ManualSaleForm pieces={PIECES} today={TODAY} />);

    chooseRow(0, "anillo-luna");
    expect(priceOf(0)).toHaveValue(1850);

    chooseRow(0, "dije-mar");
    expect(priceOf(0)).toHaveValue(1200.5);
  });

  it("lets the price be lowered for a discount, and the total follows", () => {
    render(<ManualSaleForm pieces={PIECES} today={TODAY} />);
    chooseRow(0, "anillo-luna");

    fireEvent.change(priceOf(0), { target: { value: "1500" } });

    expect(priceOf(0)).toHaveValue(1500);
    expect(total()).toHaveTextContent("$1,500.00");
  });

  it("clears the price again if the row goes back to no piece", () => {
    render(<ManualSaleForm pieces={PIECES} today={TODAY} />);
    chooseRow(0, "anillo-luna");

    chooseRow(0, "");

    expect(priceOf(0)).toHaveValue(null);
  });

  it("does not offer, in one row, a piece already chosen in another", () => {
    render(<ManualSaleForm pieces={PIECES} today={TODAY} />);
    fireEvent.click(addButton());
    chooseRow(0, "anillo-luna");

    const second = within(rows()[1]).getAllByRole("option").map((option) => option.textContent);
    const first = within(rows()[0]).getAllByRole("option").map((option) => option.textContent);

    expect(second).toEqual(["Elige una pieza", "Aretes Sol", "Dije Mar"]);
    // A row still offers its own choice, and a piece in several copies says how many.
    expect(first).toEqual([
      "Elige una pieza",
      "Anillo Luna (3 disponibles)",
      "Aretes Sol",
      "Dije Mar",
    ]);
  });

  it("adds and removes rows, but never removes the last one", () => {
    render(<ManualSaleForm pieces={PIECES} today={TODAY} />);
    expect(screen.getByRole("button", { name: "Quitar pieza 1" })).toBeDisabled();

    fireEvent.click(addButton());
    fireEvent.click(addButton());
    expect(rows()).toHaveLength(3);

    fireEvent.click(screen.getByRole("button", { name: "Quitar pieza 2" }));
    expect(rows()).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Quitar pieza 1" })).toBeEnabled();
  });

  it("keeps each row's values when another row is removed", () => {
    render(<ManualSaleForm pieces={PIECES} today={TODAY} />);
    fireEvent.click(addButton());
    fireEvent.click(addButton());
    chooseRow(0, "anillo-luna");
    chooseRow(1, "aretes-sol");
    chooseRow(2, "dije-mar");

    fireEvent.click(screen.getByRole("button", { name: "Quitar pieza 2" }));

    expect(within(rows()[0]).getByLabelText("Pieza")).toHaveValue("anillo-luna");
    expect(within(rows()[1]).getByLabelText("Pieza")).toHaveValue("dije-mar");
    expect(priceOf(1)).toHaveValue(1200.5);
  });

  it("stops at the number of pieces there are to sell", () => {
    render(<ManualSaleForm pieces={PIECES} today={TODAY} />);

    fireEvent.click(addButton());
    fireEvent.click(addButton());

    expect(rows()).toHaveLength(PIECES.length);
    expect(addButton()).toBeDisabled();
  });

  it(`never goes past ${MAX_SALE_ITEMS} rows, the most one transaction carries`, () => {
    const many = Array.from({ length: MAX_SALE_ITEMS + 5 }, (_, index) => ({
      handle: `pieza-${index}`,
      title: `Pieza ${index}`,
      price: 100,
      stock: 1,
    }));
    render(<ManualSaleForm pieces={many} today={TODAY} />);

    for (let index = 1; index < MAX_SALE_ITEMS + 5; index += 1) {
      if (!addButton().hasAttribute("disabled")) fireEvent.click(addButton());
    }

    expect(rows()).toHaveLength(MAX_SALE_ITEMS);
    expect(addButton()).toBeDisabled();
  });

  it("falls back to the handle for a piece with no title", () => {
    render(<ManualSaleForm pieces={[{ handle: "sin-titulo", title: "", price: 100, stock: 1 }]} today={TODAY} />);

    expect(within(rows()[0]).getByRole("option", { name: "sin-titulo" })).toBeInTheDocument();
  });
});

describe("ManualSaleForm: quantity", () => {
  it("is a required whole number from 1, capped at the stock of the chosen piece", () => {
    render(<ManualSaleForm pieces={PIECES} today={TODAY} />);

    expect(quantityOf(0)).toBeRequired();
    expect(quantityOf(0)).toHaveAttribute("type", "number");
    expect(quantityOf(0)).toHaveAttribute("min", "1");
    expect(quantityOf(0)).toHaveAttribute("step", "1");

    chooseRow(0, "anillo-luna");
    expect(quantityOf(0)).toHaveAttribute("max", "3");

    chooseRow(0, "aretes-sol");
    expect(quantityOf(0)).toHaveAttribute("max", "1");
  });

  it("goes back to 1 when another piece is chosen", () => {
    render(<ManualSaleForm pieces={PIECES} today={TODAY} />);
    chooseRow(0, "anillo-luna");
    fireEvent.change(quantityOf(0), { target: { value: "3" } });

    chooseRow(0, "aretes-sol");

    expect(quantityOf(0)).toHaveValue(1);
  });

  it("keeps each row's own quantity when another row is removed", () => {
    render(<ManualSaleForm pieces={PIECES} today={TODAY} />);
    fireEvent.click(addButton());
    fireEvent.click(addButton());
    chooseRow(0, "anillo-luna");
    chooseRow(1, "aretes-sol");
    chooseRow(2, "dije-mar");
    fireEvent.change(quantityOf(0), { target: { value: "2" } });

    fireEvent.click(screen.getByRole("button", { name: "Quitar pieza 2" }));

    expect(quantityOf(0)).toHaveValue(2);
    expect(quantityOf(1)).toHaveValue(1);
  });
});

describe("ManualSaleForm: live total", () => {
  it("starts at zero and sums the valid prices of every row plus the shipping", () => {
    render(<ManualSaleForm pieces={PIECES} today={TODAY} />);
    expect(total()).toHaveTextContent("$0.00");

    fireEvent.click(addButton());
    chooseRow(0, "anillo-luna");
    chooseRow(1, "aretes-sol");
    fireEvent.change(screen.getByLabelText("Envío cobrado (MXN, opcional)"), {
      target: { value: "150.50" },
    });

    expect(subtotal()).toHaveTextContent("$2,750.00");
    expect(total()).toHaveTextContent("$2,900.50");
  });

  it("multiplies each row's price by its quantity", () => {
    render(<ManualSaleForm pieces={PIECES} today={TODAY} />);
    fireEvent.click(addButton());
    chooseRow(0, "anillo-luna");
    chooseRow(1, "aretes-sol");

    fireEvent.change(quantityOf(0), { target: { value: "3" } });

    // 3 x $1,850.00 + 1 x $900.00
    expect(subtotal()).toHaveTextContent("$6,450.00");
    expect(total()).toHaveTextContent("$6,450.00");
  });

  it("counts a quantity that is not a whole number yet as nothing, instead of showing garbage", () => {
    render(<ManualSaleForm pieces={PIECES} today={TODAY} />);
    chooseRow(0, "anillo-luna");

    fireEvent.change(quantityOf(0), { target: { value: "1.5" } });
    expect(total()).toHaveTextContent("$0.00");

    fireEvent.change(quantityOf(0), { target: { value: "" } });
    expect(total()).toHaveTextContent("$0.00");
  });

  it("ignores an amount that is not yet valid instead of showing garbage", () => {
    render(<ManualSaleForm pieces={PIECES} today={TODAY} />);
    chooseRow(0, "anillo-luna");

    fireEvent.change(priceOf(0), { target: { value: "12.345" } });

    expect(total()).toHaveTextContent("$0.00");
  });
});

describe("ManualSaleForm: submitting", () => {
  function fillValidSale() {
    fireEvent.click(addButton());
    chooseRow(0, "anillo-luna");
    fireEvent.change(priceOf(0), { target: { value: "1500" } });
    fireEvent.change(quantityOf(0), { target: { value: "2" } });
    fireEvent.change(within(rows()[0]).getByLabelText("Opción (opcional)"), {
      target: { value: "Talla 7" },
    });
    chooseRow(1, "aretes-sol");
    fireEvent.change(screen.getByLabelText("Envío cobrado (MXN, opcional)"), {
      target: { value: "150" },
    });
    fireEvent.change(screen.getByLabelText("Nota (opcional)"), {
      target: { value: "Entrega en persona" },
    });
  }

  it("posts one value per row for each repeated field, plus the header fields and 'Descontar de la tienda'", async () => {
    recordActionMock.mockResolvedValue({ ok: true });
    render(<ManualSaleForm pieces={PIECES} today={TODAY} />);
    fillValidSale();

    fireEvent.click(submitButton());

    await waitFor(() => expect(recordActionMock).toHaveBeenCalledTimes(1));
    const [formData] = recordActionMock.mock.calls[0] as [FormData];
    expect(formData.get("date")).toBe(TODAY);
    expect(formData.get("shipping")).toBe("150");
    expect(formData.get("note")).toBe("Entrega en persona");
    expect(formData.get("decrementStock")).toBe("on");
    expect(formData.getAll("itemHandle")).toEqual(["anillo-luna", "aretes-sol"]);
    expect(formData.getAll("itemPrice")).toEqual(["1500", "900.00"]);
    expect(formData.getAll("itemQuantity")).toEqual(["2", "1"]);
    expect(formData.getAll("itemOption")).toEqual(["Talla 7", ""]);
  });

  it("posts the terminal's commission when one is typed, as the field's own value", async () => {
    recordActionMock.mockResolvedValue({ ok: true });
    render(<ManualSaleForm pieces={PIECES} today={TODAY} />);
    chooseRow(0, "anillo-luna");
    fireEvent.change(screen.getByLabelText("Comisión (terminal, MXN, opcional)"), {
      target: { value: "67.50" },
    });

    fireEvent.click(submitButton());

    await waitFor(() => expect(recordActionMock).toHaveBeenCalledTimes(1));
    const [formData] = recordActionMock.mock.calls[0] as [FormData];
    expect(formData.get("terminalFee")).toBe("67.50");
  });

  it("posts an empty commission when none is typed: the server reads that as none (cash)", async () => {
    recordActionMock.mockResolvedValue({ ok: true });
    render(<ManualSaleForm pieces={PIECES} today={TODAY} />);
    chooseRow(0, "anillo-luna");

    fireEvent.click(submitButton());

    await waitFor(() => expect(recordActionMock).toHaveBeenCalledTimes(1));
    const [formData] = recordActionMock.mock.calls[0] as [FormData];
    expect(formData.get("terminalFee")).toBe("");
  });

  it("offers the terminal's commission as an optional, non-negative amount in pesos, with a plain-words hint", () => {
    render(<ManualSaleForm pieces={PIECES} today={TODAY} />);

    const field = screen.getByLabelText("Comisión (terminal, MXN, opcional)");
    expect(field).not.toBeRequired();
    expect(field).toHaveAttribute("type", "number");
    expect(field).toHaveAttribute("min", "0");
    expect(field).toHaveAttribute("step", "0.01");
    expect(field).toHaveValue(null);
    expect(field).toHaveAccessibleDescription(/Lo que cobró la terminal por esta venta/);
    expect(field).toHaveAccessibleDescription(/Déjalo vacío si cobraste en efectivo/);
  });

  it("does not change the live total: the commission is a cost of the sale, not part of what was paid", () => {
    render(<ManualSaleForm pieces={PIECES} today={TODAY} />);
    chooseRow(0, "anillo-luna");

    fireEvent.change(screen.getByLabelText("Comisión (terminal, MXN, opcional)"), {
      target: { value: "67.50" },
    });

    expect(total()).toHaveTextContent("$1,850.00");
  });

  it("clears the commission with the rest of the form after a recorded sale, and keeps it on failure", async () => {
    recordActionMock.mockResolvedValueOnce({
      ok: false,
      error: "invalid-sale",
      message: "La venta no es válida. Revisa las piezas y los montos.",
    });
    render(<ManualSaleForm pieces={PIECES} today={TODAY} />);
    chooseRow(0, "anillo-luna");
    fireEvent.change(screen.getByLabelText("Comisión (terminal, MXN, opcional)"), {
      target: { value: "67.50" },
    });

    fireEvent.click(submitButton());
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByLabelText("Comisión (terminal, MXN, opcional)")).toHaveValue(67.5);

    recordActionMock.mockResolvedValue({ ok: true });
    await waitFor(() => expect(submitButton()).toBeEnabled());
    fireEvent.click(submitButton());

    expect(await screen.findByRole("status")).toHaveTextContent("Venta registrada.");
    expect(screen.getByLabelText("Comisión (terminal, MXN, opcional)")).toHaveValue(null);
  });

  it("posts no decrementStock at all when the checkbox is unticked", async () => {
    recordActionMock.mockResolvedValue({ ok: true });
    render(<ManualSaleForm pieces={PIECES} today={TODAY} />);
    chooseRow(0, "anillo-luna");
    fireEvent.click(screen.getByLabelText("Descontar de la tienda"));

    fireEvent.click(submitButton());

    await waitFor(() => expect(recordActionMock).toHaveBeenCalledTimes(1));
    const [formData] = recordActionMock.mock.calls[0] as [FormData];
    expect(formData.has("decrementStock")).toBe(false);
    expect(formData.has("markSold")).toBe(false);
  });

  it("explains what 'Descontar de la tienda' does in plain words", () => {
    render(<ManualSaleForm pieces={PIECES} today={TODAY} />);

    expect(screen.getByLabelText("Descontar de la tienda")).toHaveAccessibleDescription(
      /Resta las piezas vendidas de las disponibles en la tienda en línea/,
    );
  });

  it("confirms success and clears the form back to one empty row, today and the checkbox on", async () => {
    recordActionMock.mockResolvedValue({ ok: true });
    render(<ManualSaleForm pieces={PIECES} today={TODAY} />);
    fillValidSale();
    fireEvent.click(screen.getByLabelText("Descontar de la tienda"));

    fireEvent.click(submitButton());

    expect(await screen.findByRole("status")).toHaveTextContent("Venta registrada.");
    expect(rows()).toHaveLength(1);
    expect(within(rows()[0]).getByLabelText("Pieza")).toHaveValue("");
    expect(priceOf(0)).toHaveValue(null);
    expect(quantityOf(0)).toHaveValue(1);
    expect(screen.getByLabelText("Envío cobrado (MXN, opcional)")).toHaveValue(null);
    expect(screen.getByLabelText("Nota (opcional)")).toHaveValue("");
    expect(screen.getByLabelText("Fecha")).toHaveValue(TODAY);
    expect(screen.getByLabelText("Descontar de la tienda")).toBeChecked();
    expect(total()).toHaveTextContent("$0.00");
  });

  it("shows the warning next to the confirmation when the store could not be updated, and still clears", async () => {
    recordActionMock.mockResolvedValue({
      ok: true,
      warning: {
        code: "store-not-updated",
        message: "La venta quedó registrada, pero no se pudo descontar de la tienda la pieza «Anillo Luna». Ajusta sus piezas disponibles desde Studio.",
      },
    });
    render(<ManualSaleForm pieces={PIECES} today={TODAY} />);
    fillValidSale();

    fireEvent.click(submitButton());

    expect(await screen.findByRole("status")).toHaveTextContent("Venta registrada.");
    expect(screen.getByRole("alert")).toHaveTextContent("«Anillo Luna»");
    expect(screen.getByRole("alert")).toHaveTextContent("desde Studio");
    expect(rows()).toHaveLength(1);
  });

  it("shows the oversold warning next to the confirmation, and still clears", async () => {
    recordActionMock.mockResolvedValue({
      ok: true,
      warning: {
        code: "oversold",
        message:
          "Se vendieron más piezas de «Anillo Luna» de las que había en la tienda: quedó en 0 y la venta lleva la marca «Revisar: sobreventa».",
      },
    });
    render(<ManualSaleForm pieces={PIECES} today={TODAY} />);
    fillValidSale();

    fireEvent.click(submitButton());

    expect(await screen.findByRole("status")).toHaveTextContent("Venta registrada.");
    expect(screen.getByRole("alert")).toHaveTextContent("Revisar: sobreventa");
    expect(rows()).toHaveLength(1);
  });

  it("shows the server's message and KEEPS what was typed when it fails", async () => {
    recordActionMock.mockResolvedValue({
      ok: false,
      error: "piece-unavailable",
      message: "Una de las piezas ya está agotada o no tiene tantas piezas disponibles. Recarga la página para ver cuántas quedan.",
    });
    render(<ManualSaleForm pieces={PIECES} today={TODAY} />);
    fillValidSale();

    fireEvent.click(submitButton());

    expect(await screen.findByRole("alert")).toHaveTextContent("tantas piezas disponibles");
    expect(rows()).toHaveLength(2);
    expect(priceOf(0)).toHaveValue(1500);
    expect(screen.getByLabelText("Nota (opcional)")).toHaveValue("Entrega en persona");
    await waitFor(() => expect(submitButton()).toBeEnabled());
  });

  it("shows a generic message when the request itself fails, without leaking its error", async () => {
    recordActionMock.mockRejectedValue(new Error("network down"));
    render(<ManualSaleForm pieces={PIECES} today={TODAY} />);
    fillValidSale();

    fireEvent.click(submitButton());

    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo guardar");
    expect(screen.getByRole("alert")).not.toHaveTextContent("network down");
  });

  it("disables the form while the sale is being recorded, so it cannot be double-submitted", async () => {
    let finish: (value: { ok: true }) => void = () => undefined;
    recordActionMock.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    render(<ManualSaleForm pieces={PIECES} today={TODAY} />);
    fillValidSale();

    fireEvent.click(submitButton());

    expect(await screen.findByRole("button", { name: "Registrando…" })).toBeDisabled();
    fireEvent.submit(
      screen.getByRole("button", { name: "Registrando…" }).closest("form") as HTMLFormElement,
    );
    expect(recordActionMock).toHaveBeenCalledTimes(1);

    finish({ ok: true });
    expect(await screen.findByRole("status")).toBeInTheDocument();
  });

  it("reminds the admin not to write the customer's personal data in the note", () => {
    render(<ManualSaleForm pieces={PIECES} today={TODAY} />);

    expect(screen.getByLabelText("Nota (opcional)")).toHaveAccessibleDescription(
      /No escribas datos personales/,
    );
  });
});

describe("VoidSaleForm", () => {
  it("asks for confirmation before anything is sent, and Cancelar backs out", () => {
    render(<VoidSaleForm saleId="sale1" />);

    fireEvent.click(screen.getByRole("button", { name: "Anular venta" }));

    expect(voidActionMock).not.toHaveBeenCalled();
    expect(screen.getByText(/La pieza no vuelve a la tienda/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.getByRole("button", { name: "Anular venta" })).toBeInTheDocument();
    expect(voidActionMock).not.toHaveBeenCalled();
  });

  it("posts the sale id once confirmed", async () => {
    voidActionMock.mockResolvedValue({ ok: true });
    render(<VoidSaleForm saleId="sale1" />);
    fireEvent.click(screen.getByRole("button", { name: "Anular venta" }));

    fireEvent.click(screen.getByRole("button", { name: "Sí, anular venta" }));

    await waitFor(() => expect(voidActionMock).toHaveBeenCalledTimes(1));
    const [formData] = voidActionMock.mock.calls[0] as [FormData];
    expect(formData.get("saleId")).toBe("sale1");
    expect(await screen.findByRole("status")).toHaveTextContent("Venta anulada.");
  });

  it("shows the server's message when it fails and keeps the confirmation open to retry", async () => {
    voidActionMock.mockResolvedValue({
      ok: false,
      error: "sale-not-voidable",
      message: "Solo se pueden anular las ventas manuales.",
    });
    render(<VoidSaleForm saleId="sale1" />);
    fireEvent.click(screen.getByRole("button", { name: "Anular venta" }));

    fireEvent.click(screen.getByRole("button", { name: "Sí, anular venta" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Solo se pueden anular");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Sí, anular venta" })).toBeEnabled(),
    );
  });

  it("shows a generic message when the request itself fails", async () => {
    voidActionMock.mockRejectedValue(new Error("network down"));
    render(<VoidSaleForm saleId="sale1" />);
    fireEvent.click(screen.getByRole("button", { name: "Anular venta" }));

    fireEvent.click(screen.getByRole("button", { name: "Sí, anular venta" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo guardar");
    expect(screen.getByRole("alert")).not.toHaveTextContent("network down");
  });

  it("disables both buttons while voiding, so it cannot be sent twice", async () => {
    let finish: (value: { ok: true }) => void = () => undefined;
    voidActionMock.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    render(<VoidSaleForm saleId="sale1" />);
    fireEvent.click(screen.getByRole("button", { name: "Anular venta" }));

    fireEvent.click(screen.getByRole("button", { name: "Sí, anular venta" }));

    expect(await screen.findByRole("button", { name: "Anulando…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeDisabled();
    fireEvent.submit(
      screen.getByRole("button", { name: "Anulando…" }).closest("form") as HTMLFormElement,
    );
    expect(voidActionMock).toHaveBeenCalledTimes(1);

    finish({ ok: true });
    expect(await screen.findByRole("status")).toBeInTheDocument();
  });
});

describe("RefreshFeeForm", () => {
  it("posts only the sale id when 'Actualizar comisión' is pressed, and confirms on success", async () => {
    refreshActionMock.mockResolvedValue({ ok: true });
    render(<RefreshFeeForm saleId="stripe_cs_live_1" />);

    fireEvent.click(screen.getByRole("button", { name: "Actualizar comisión" }));

    await waitFor(() => expect(refreshActionMock).toHaveBeenCalledTimes(1));
    const [formData] = refreshActionMock.mock.calls[0] as [FormData];
    expect([...formData.keys()]).toEqual(["saleId"]);
    expect(formData.get("saleId")).toBe("stripe_cs_live_1");
    expect(await screen.findByRole("status")).toHaveTextContent("Comisión actualizada.");
  });

  it("shows the server's message when Stripe has no fee yet, and lets the admin try again", async () => {
    refreshActionMock.mockResolvedValue({
      ok: false,
      error: "fee-unavailable",
      message: "Stripe todavía no entrega la comisión de esta venta. Inténtalo de nuevo en unos minutos.",
    });
    render(<RefreshFeeForm saleId="stripe_cs_live_1" />);

    fireEvent.click(screen.getByRole("button", { name: "Actualizar comisión" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Inténtalo de nuevo");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Actualizar comisión" })).toBeEnabled(),
    );
  });

  it("shows a generic message when the request itself fails, without leaking its error", async () => {
    refreshActionMock.mockRejectedValue(new Error("network down"));
    render(<RefreshFeeForm saleId="stripe_cs_live_1" />);

    fireEvent.click(screen.getByRole("button", { name: "Actualizar comisión" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo guardar");
    expect(screen.getByRole("alert")).not.toHaveTextContent("network down");
  });

  it("disables the button while Stripe is being asked, so it cannot be sent twice", async () => {
    let finish: (value: { ok: true }) => void = () => undefined;
    refreshActionMock.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    render(<RefreshFeeForm saleId="stripe_cs_live_1" />);

    fireEvent.click(screen.getByRole("button", { name: "Actualizar comisión" }));

    expect(await screen.findByRole("button", { name: "Consultando a Stripe…" })).toBeDisabled();
    fireEvent.submit(
      screen.getByRole("button", { name: "Consultando a Stripe…" }).closest("form") as HTMLFormElement,
    );
    expect(refreshActionMock).toHaveBeenCalledTimes(1);

    finish({ ok: true });
    expect(await screen.findByRole("status")).toBeInTheDocument();
  });
});
