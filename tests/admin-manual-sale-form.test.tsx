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
vi.mock("@/app/admin/(panel)/ventas/actions", () => ({
  recordManualSaleAction: (...args: unknown[]) => recordActionMock(...args),
  voidSaleAction: (...args: unknown[]) => voidActionMock(...args),
}));

import { MAX_SALE_ITEMS } from "@/lib/admin/domain/sales";
import {
  ManualSaleForm,
  type SalePiece,
} from "../app/admin/(panel)/ventas/ManualSaleForm";
import { VoidSaleForm } from "../app/admin/(panel)/ventas/VoidSaleForm";

const TODAY = "2026-10-02";
const PIECES: SalePiece[] = [
  { handle: "anillo-luna", title: "Anillo Luna", price: 185_000 },
  { handle: "aretes-sol", title: "Aretes Sol", price: 90_000 },
  { handle: "dije-mar", title: "Dije Mar", price: 120_050 },
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

function priceOf(index: number) {
  return within(rows()[index]).getByLabelText("Precio (MXN)");
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("ManualSaleForm: the piece rows", () => {
  it("starts with one row, a date of today that cannot be in the future, and the store checkbox on", () => {
    render(<ManualSaleForm pieces={PIECES} today={TODAY} />);

    expect(rows()).toHaveLength(1);
    expect(screen.getByLabelText("Fecha")).toHaveValue(TODAY);
    expect(screen.getByLabelText("Fecha")).toHaveAttribute("max", TODAY);
    expect(screen.getByLabelText("Marcar como vendida en la tienda")).toBeChecked();
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
    // A row still offers its own choice.
    expect(first).toEqual(["Elige una pieza", "Anillo Luna", "Aretes Sol", "Dije Mar"]);
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
    }));
    render(<ManualSaleForm pieces={many} today={TODAY} />);

    for (let index = 1; index < MAX_SALE_ITEMS + 5; index += 1) {
      if (!addButton().hasAttribute("disabled")) fireEvent.click(addButton());
    }

    expect(rows()).toHaveLength(MAX_SALE_ITEMS);
    expect(addButton()).toBeDisabled();
  });

  it("falls back to the handle for a piece with no title", () => {
    render(<ManualSaleForm pieces={[{ handle: "sin-titulo", title: "", price: 100 }]} today={TODAY} />);

    expect(within(rows()[0]).getByRole("option", { name: "sin-titulo" })).toBeInTheDocument();
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

  it("posts one value per row for each repeated field, plus the header fields and the checkbox", async () => {
    recordActionMock.mockResolvedValue({ ok: true });
    render(<ManualSaleForm pieces={PIECES} today={TODAY} />);
    fillValidSale();

    fireEvent.click(submitButton());

    await waitFor(() => expect(recordActionMock).toHaveBeenCalledTimes(1));
    const [formData] = recordActionMock.mock.calls[0] as [FormData];
    expect(formData.get("date")).toBe(TODAY);
    expect(formData.get("shipping")).toBe("150");
    expect(formData.get("note")).toBe("Entrega en persona");
    expect(formData.get("markSold")).toBe("on");
    expect(formData.getAll("itemHandle")).toEqual(["anillo-luna", "aretes-sol"]);
    expect(formData.getAll("itemPrice")).toEqual(["1500", "900.00"]);
    expect(formData.getAll("itemOption")).toEqual(["Talla 7", ""]);
  });

  it("posts no markSold at all when the store checkbox is unticked", async () => {
    recordActionMock.mockResolvedValue({ ok: true });
    render(<ManualSaleForm pieces={PIECES} today={TODAY} />);
    chooseRow(0, "anillo-luna");
    fireEvent.click(screen.getByLabelText("Marcar como vendida en la tienda"));

    fireEvent.click(submitButton());

    await waitFor(() => expect(recordActionMock).toHaveBeenCalledTimes(1));
    const [formData] = recordActionMock.mock.calls[0] as [FormData];
    expect(formData.has("markSold")).toBe(false);
  });

  it("confirms success and clears the form back to one empty row, today and the checkbox on", async () => {
    recordActionMock.mockResolvedValue({ ok: true });
    render(<ManualSaleForm pieces={PIECES} today={TODAY} />);
    fillValidSale();
    fireEvent.click(screen.getByLabelText("Marcar como vendida en la tienda"));

    fireEvent.click(submitButton());

    expect(await screen.findByRole("status")).toHaveTextContent("Venta registrada.");
    expect(rows()).toHaveLength(1);
    expect(within(rows()[0]).getByLabelText("Pieza")).toHaveValue("");
    expect(priceOf(0)).toHaveValue(null);
    expect(screen.getByLabelText("Envío cobrado (MXN, opcional)")).toHaveValue(null);
    expect(screen.getByLabelText("Nota (opcional)")).toHaveValue("");
    expect(screen.getByLabelText("Fecha")).toHaveValue(TODAY);
    expect(screen.getByLabelText("Marcar como vendida en la tienda")).toBeChecked();
    expect(total()).toHaveTextContent("$0.00");
  });

  it("shows the warning next to the confirmation when the store could not be updated, and still clears", async () => {
    recordActionMock.mockResolvedValue({
      ok: true,
      warning: {
        code: "store-not-updated",
        message: "La venta quedó registrada, pero no se pudo marcar como vendida en la tienda la pieza «Anillo Luna». Márcala como vendida desde Studio.",
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

  it("shows the server's message and KEEPS what was typed when it fails", async () => {
    recordActionMock.mockResolvedValue({
      ok: false,
      error: "piece-unavailable",
      message: "Una de las piezas ya está vendida. Recarga la página para ver las que siguen disponibles.",
    });
    render(<ManualSaleForm pieces={PIECES} today={TODAY} />);
    fillValidSale();

    fireEvent.click(submitButton());

    expect(await screen.findByRole("alert")).toHaveTextContent("ya está vendida");
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
