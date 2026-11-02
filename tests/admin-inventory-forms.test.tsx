// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// The Server Actions are mocked: this file covers what the three form islands
// add on top of them — what they post, the previews, and showing the typed
// result. The actions' own behavior (authorization first, zod validation,
// transactions) is in tests/admin-inventory-actions.test.ts.
const createActionMock = vi.fn();
const adjustActionMock = vi.fn();
const correctActionMock = vi.fn();
vi.mock("@/app/admin/(panel)/inventario/actions", () => ({
  createMaterialAction: (...args: unknown[]) => createActionMock(...args),
  adjustStockAction: (...args: unknown[]) => adjustActionMock(...args),
  correctStockAction: (...args: unknown[]) => correctActionMock(...args),
}));

import {
  AdjustStockForm,
  type AdjustableMaterial,
} from "../app/admin/(panel)/inventario/AdjustStockForm";
import { CorrectStockForm } from "../app/admin/(panel)/inventario/CorrectStockForm";
import { CreateMaterialForm } from "../app/admin/(panel)/inventario/CreateMaterialForm";

beforeEach(() => {
  vi.resetAllMocks();
});

describe("CreateMaterialForm", () => {
  const nameField = () => screen.getByLabelText("Nombre");
  const submit = () => screen.getByRole("button", { name: "Crear material" });

  it("offers every kind and unit, starting on fine silver in grams", () => {
    render(<CreateMaterialForm />);

    expect(
      within(screen.getByLabelText("Tipo")).getAllByRole("option").map((option) => option.textContent),
    ).toEqual(["Plata fina", "Oro fino", "Liga", "Piedra", "Otro"]);
    expect(
      within(screen.getByLabelText("Unidad")).getAllByRole("option").map((option) => option.textContent),
    ).toEqual(["Gramos (g)", "Piezas (pz)"]);
    expect(screen.getByLabelText("Tipo")).toHaveValue("fine_silver");
    expect(screen.getByLabelText("Unidad")).toHaveValue("g");
  });

  it("suggests pieces for stones and miscellany and grams for everything weighed, still changeable", () => {
    render(<CreateMaterialForm />);

    fireEvent.change(screen.getByLabelText("Tipo"), { target: { value: "stone" } });
    expect(screen.getByLabelText("Unidad")).toHaveValue("pz");

    fireEvent.change(screen.getByLabelText("Tipo"), { target: { value: "alloy" } });
    expect(screen.getByLabelText("Unidad")).toHaveValue("g");

    fireEvent.change(screen.getByLabelText("Unidad"), { target: { value: "pz" } });
    expect(screen.getByLabelText("Unidad")).toHaveValue("pz");
  });

  it("asks for what she already has, optionally, with its cost", () => {
    render(<CreateMaterialForm />);

    expect(screen.getByText(/Si lo dejas en blanco empieza en 0/)).toBeInTheDocument();
    expect(screen.getByLabelText("Cantidad inicial (g)")).not.toBeRequired();
    expect(screen.getByLabelText("Costo total (MXN)")).not.toBeRequired();

    // The unit of the quantity follows the unit of the material.
    fireEvent.change(screen.getByLabelText("Unidad"), { target: { value: "pz" } });
    expect(screen.getByLabelText("Cantidad inicial (pz)")).toBeInTheDocument();
  });

  it("requires the cost as soon as a quantity above 0 is typed, and previews the average", () => {
    render(<CreateMaterialForm />);

    fireEvent.change(screen.getByLabelText("Cantidad inicial (g)"), { target: { value: "30" } });
    expect(screen.getByLabelText("Costo total (MXN)")).toBeRequired();
    // Nothing to average until the cost is typed.
    expect(screen.queryByText("Costo promedio")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Costo total (MXN)"), { target: { value: "1000" } });
    expect(screen.getByText("Costo promedio").parentElement).toHaveTextContent("$33.33 / g");

    // A free opening stock is a valid answer.
    fireEvent.change(screen.getByLabelText("Costo total (MXN)"), { target: { value: "0" } });
    expect(screen.getByText("Costo promedio").parentElement).toHaveTextContent("$0.00 / g");
  });

  it("does not require the cost for a quantity of 0", () => {
    render(<CreateMaterialForm />);

    fireEvent.change(screen.getByLabelText("Cantidad inicial (g)"), { target: { value: "0" } });

    expect(screen.getByLabelText("Costo total (MXN)")).not.toBeRequired();
  });

  it("posts the name, kind, unit and a blank opening stock", async () => {
    createActionMock.mockResolvedValue({ ok: true });
    render(<CreateMaterialForm />);
    fireEvent.change(nameField(), { target: { value: "Circones 2 mm" } });
    fireEvent.change(screen.getByLabelText("Tipo"), { target: { value: "stone" } });

    fireEvent.click(submit());

    await waitFor(() => expect(createActionMock).toHaveBeenCalledTimes(1));
    const [formData] = createActionMock.mock.calls[0] as [FormData];
    expect(Object.fromEntries(formData.entries())).toEqual({
      name: "Circones 2 mm",
      kind: "stone",
      unit: "pz",
      initialQty: "",
      initialCost: "",
    });
  });

  it("posts the opening quantity and its total cost", async () => {
    createActionMock.mockResolvedValue({ ok: true });
    render(<CreateMaterialForm />);
    fireEvent.change(nameField(), { target: { value: "Plata fina" } });
    fireEvent.change(screen.getByLabelText("Cantidad inicial (g)"), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText("Costo total (MXN)"), { target: { value: "1000" } });

    fireEvent.click(submit());

    await waitFor(() => expect(createActionMock).toHaveBeenCalledTimes(1));
    const [formData] = createActionMock.mock.calls[0] as [FormData];
    expect(formData.get("initialQty")).toBe("30");
    expect(formData.get("initialCost")).toBe("1000");
  });

  it("confirms success and clears the form", async () => {
    createActionMock.mockResolvedValue({ ok: true });
    render(<CreateMaterialForm />);
    fireEvent.change(nameField(), { target: { value: "Plata fina" } });
    fireEvent.change(screen.getByLabelText("Tipo"), { target: { value: "stone" } });
    fireEvent.change(screen.getByLabelText("Cantidad inicial (pz)"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Costo total (MXN)"), { target: { value: "50" } });

    fireEvent.click(submit());

    expect(await screen.findByRole("status")).toHaveTextContent("Material creado.");
    expect(nameField()).toHaveValue("");
    expect(screen.getByLabelText("Tipo")).toHaveValue("fine_silver");
    expect(screen.getByLabelText("Unidad")).toHaveValue("g");
    expect(screen.getByLabelText("Cantidad inicial (g)")).toHaveValue(null);
    expect(screen.getByLabelText("Costo total (MXN)")).toHaveValue(null);
  });

  it("shows the server's message and KEEPS what was typed when it fails", async () => {
    createActionMock.mockResolvedValue({
      ok: false,
      error: "invalid",
      message: "Nombre: es obligatorio.",
    });
    render(<CreateMaterialForm />);
    fireEvent.change(nameField(), { target: { value: "x" } });
    fireEvent.change(screen.getByLabelText("Cantidad inicial (g)"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Costo total (MXN)"), { target: { value: "10" } });

    fireEvent.click(submit());

    expect(await screen.findByRole("alert")).toHaveTextContent("Nombre: es obligatorio.");
    expect(nameField()).toHaveValue("x");
    expect(screen.getByLabelText("Cantidad inicial (g)")).toHaveValue(3);
    expect(screen.getByLabelText("Costo total (MXN)")).toHaveValue(10);
    await waitFor(() => expect(submit()).toBeEnabled());
  });

  it("shows a generic message when the request itself fails", async () => {
    createActionMock.mockRejectedValue(new Error("network down"));
    render(<CreateMaterialForm />);
    fireEvent.change(nameField(), { target: { value: "Plata" } });

    fireEvent.click(submit());

    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo guardar");
    expect(screen.getByRole("alert")).not.toHaveTextContent("network down");
  });
});

describe("AdjustStockForm", () => {
  // The state the Plata bug leaves: 60 g at $16.67/g.
  const SILVER: AdjustableMaterial = {
    id: "silver",
    name: "Plata fina",
    unit: "g",
    stock: 60,
    avgCost: 1667,
  };
  const STONES: AdjustableMaterial = {
    id: "stones",
    name: "Circones",
    unit: "pz",
    stock: 10,
    avgCost: 500,
  };
  const submit = () => screen.getByRole("button", { name: "Ajustar existencias" });
  const quantity = () => screen.getByLabelText(/^Cantidad/);
  const unitCost = () => screen.getByLabelText(/^Costo por unidad/);
  const preview = () => screen.getByText("Quedaría así").parentElement as HTMLElement;

  function type(label: string | RegExp, value: string) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }

  it("states the current stock and average, and points to Registrar compra", () => {
    render(<AdjustStockForm material={SILVER} />);

    expect(screen.getByText(/Ahora hay 60\.00 g a \$16\.67 \/ g/)).toBeInTheDocument();
    expect(screen.getByText(/¿Compraste material\? Usa Registrar compra\./)).toBeInTheDocument();
  });

  it("offers a physical count and a loss, and explains how to subtract", () => {
    render(<AdjustStockForm material={SILVER} />);

    expect(
      within(screen.getByLabelText("Tipo")).getAllByRole("option").map((option) => option.textContent),
    ).toEqual(["Conteo físico (suma o resta)", "Merma / pérdida (solo resta)"]);
    expect(quantity()).toHaveAccessibleDescription(/Usa un número negativo para restar/);
  });

  it("shows the unit of the material in the quantity label", () => {
    const { unmount } = render(<AdjustStockForm material={SILVER} />);
    expect(screen.getByText("Cantidad (g)")).toBeInTheDocument();
    unmount();

    render(<AdjustStockForm material={STONES} />);
    expect(screen.getByText("Cantidad (pz)")).toBeInTheDocument();
  });

  it("asks for the unit cost ONLY when a count adds stock, prefilled with the current average", () => {
    render(<AdjustStockForm material={SILVER} />);
    expect(screen.queryByLabelText(/^Costo por unidad/)).not.toBeInTheDocument();

    type(/^Cantidad/, "-2");
    expect(screen.queryByLabelText(/^Costo por unidad/)).not.toBeInTheDocument();

    type(/^Cantidad/, "10");
    expect(unitCost()).toBeRequired();
    expect(unitCost()).toHaveValue(16.67);

    // A loss never adds, so never asks for a cost.
    type("Tipo", "loss");
    expect(screen.queryByLabelText(/^Costo por unidad/)).not.toBeInTheDocument();
  });

  it("previews the resulting stock and re-weighted average BEFORE saving", () => {
    render(<AdjustStockForm material={SILVER} />);
    expect(preview()).toHaveTextContent("Escribe la cantidad");

    type(/^Cantidad/, "30");
    type(/^Costo por unidad/, "10");

    // (60 x 1667 + 30 x 1000) / 90 = 1444.67 -> 1445
    expect(preview()).toHaveTextContent("Existencias90.00 g");
    expect(preview()).toHaveTextContent("Costo promedio$14.45 / g");
  });

  it("previews a removal without touching the average", () => {
    render(<AdjustStockForm material={SILVER} />);

    type(/^Cantidad/, "-10");

    expect(preview()).toHaveTextContent("Existencias50.00 g");
    expect(preview()).toHaveTextContent("Costo promedio$16.67 / g");
  });

  it("says so when a removal would go below zero, or a loss is not negative", () => {
    render(<AdjustStockForm material={SILVER} />);

    type(/^Cantidad/, "-61");
    expect(preview()).toHaveTextContent("Las existencias no alcanzan");

    type("Tipo", "loss");
    type(/^Cantidad/, "5");
    expect(preview()).toHaveTextContent("Una merma se escribe en negativo");
  });

  it("posts the material, the signed quantity, the kind, the unit cost and the reason", async () => {
    adjustActionMock.mockResolvedValue({ ok: true });
    render(<AdjustStockForm material={SILVER} />);
    type(/^Cantidad/, "10");
    type(/^Costo por unidad/, "25.5");
    type("Motivo", "Conteo físico");

    fireEvent.click(submit());

    await waitFor(() => expect(adjustActionMock).toHaveBeenCalledTimes(1));
    const [formData] = adjustActionMock.mock.calls[0] as [FormData];
    expect(Object.fromEntries(formData.entries())).toEqual({
      materialId: "silver",
      kind: "adjustment",
      delta: "10",
      unitCost: "25.5",
      reason: "Conteo físico",
    });
  });

  it("posts a loss without any cost", async () => {
    adjustActionMock.mockResolvedValue({ ok: true });
    render(<AdjustStockForm material={SILVER} />);
    type("Tipo", "loss");
    type(/^Cantidad/, "-2.5");
    type("Motivo", "Limaduras");

    fireEvent.click(submit());

    await waitFor(() => expect(adjustActionMock).toHaveBeenCalledTimes(1));
    const [formData] = adjustActionMock.mock.calls[0] as [FormData];
    expect(Object.fromEntries(formData.entries())).toEqual({
      materialId: "silver",
      kind: "loss",
      delta: "-2.5",
      reason: "Limaduras",
    });
  });

  it("confirms success and clears the form", async () => {
    adjustActionMock.mockResolvedValue({ ok: true });
    render(<AdjustStockForm material={SILVER} />);
    type(/^Cantidad/, "-2.5");
    type("Motivo", "Conteo físico");

    fireEvent.click(submit());

    expect(await screen.findByRole("status")).toHaveTextContent("Existencias ajustadas.");
    expect(quantity()).toHaveValue(null);
    expect(screen.getByLabelText("Motivo")).toHaveValue("");
  });

  it("shows the server's message and KEEPS what was typed when it fails", async () => {
    adjustActionMock.mockResolvedValue({
      ok: false,
      error: "insufficient-stock",
      message: "Las existencias no alcanzan para esta operación.",
    });
    render(<AdjustStockForm material={SILVER} />);
    type(/^Cantidad/, "-2.5");
    type("Motivo", "Conteo físico");

    fireEvent.click(submit());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Las existencias no alcanzan para esta operación.",
    );
    expect(quantity()).toHaveValue(-2.5);
    expect(screen.getByLabelText("Motivo")).toHaveValue("Conteo físico");
    await waitFor(() => expect(submit()).toBeEnabled());
  });

  it("shows a generic message when the request itself fails", async () => {
    adjustActionMock.mockRejectedValue(new Error("network down"));
    render(<AdjustStockForm material={SILVER} />);
    type(/^Cantidad/, "-2.5");
    type("Motivo", "Conteo físico");

    fireEvent.click(submit());

    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo guardar");
    expect(screen.getByRole("alert")).not.toHaveTextContent("network down");
  });
});

describe("CorrectStockForm", () => {
  const BUGGY_PLATA: AdjustableMaterial = {
    id: "plata",
    name: "Plata",
    unit: "g",
    stock: 60,
    avgCost: 1667,
  };
  const submit = () => screen.getByRole("button", { name: "Corregir" });
  const comparison = () => screen.getByRole("table");

  function type(label: string | RegExp, value: string) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }

  it("starts from the current stock and average, and shows them as the current column", () => {
    render(<CorrectStockForm material={BUGGY_PLATA} />);

    expect(screen.getByLabelText(/^Existencias reales/)).toHaveValue(60);
    expect(screen.getByLabelText(/^Costo promedio real/)).toHaveValue(16.67);
    const rows = within(comparison()).getAllByRole("row");
    expect(rows[1]).toHaveTextContent("Existencias60.00 g60.00 g");
    expect(rows[2]).toHaveTextContent("Costo promedio$16.67 / g$16.67 / g");
  });

  it("shows current vs new values, including the value of the inventory, before confirming", () => {
    render(<CorrectStockForm material={BUGGY_PLATA} />);

    type(/^Existencias reales/, "30");
    type(/^Costo promedio real/, "33.33");

    const rows = within(comparison()).getAllByRole("row");
    expect(rows[1]).toHaveTextContent("Existencias60.00 g30.00 g");
    expect(rows[2]).toHaveTextContent("Costo promedio$16.67 / g$33.33 / g");
    // 60 x 16.67 = 1,000.20 now; 30 x 33.33 = 999.90 after.
    expect(rows[3]).toHaveTextContent("Valor$1,000.20$999.90");
  });

  it("shows a dash for a figure that is not a valid number yet", () => {
    render(<CorrectStockForm material={BUGGY_PLATA} />);

    type(/^Existencias reales/, "");

    expect(within(comparison()).getAllByRole("row")[1]).toHaveTextContent("Existencias60.00 g—");
  });

  it("posts the material, the real stock, the real average and the reason", async () => {
    correctActionMock.mockResolvedValue({ ok: true });
    render(<CorrectStockForm material={BUGGY_PLATA} />);
    type(/^Existencias reales/, "30");
    type(/^Costo promedio real/, "33.33");
    type("Motivo", "Error al capturar");

    fireEvent.click(submit());

    await waitFor(() => expect(correctActionMock).toHaveBeenCalledTimes(1));
    const [formData] = correctActionMock.mock.calls[0] as [FormData];
    expect(Object.fromEntries(formData.entries())).toEqual({
      materialId: "plata",
      stock: "30",
      avgCost: "33.33",
      reason: "Error al capturar",
    });
  });

  it("requires a reason", () => {
    render(<CorrectStockForm material={BUGGY_PLATA} />);

    expect(screen.getByLabelText("Motivo")).toBeRequired();
    expect(screen.getByLabelText("Motivo")).toHaveAttribute("minlength", "3");
  });

  it("confirms success", async () => {
    correctActionMock.mockResolvedValue({ ok: true });
    render(<CorrectStockForm material={BUGGY_PLATA} />);
    type(/^Existencias reales/, "30");
    type("Motivo", "Error al capturar");

    fireEvent.click(submit());

    expect(await screen.findByRole("status")).toHaveTextContent("Existencias y costo corregidos.");
    expect(screen.getByLabelText("Motivo")).toHaveValue("");
  });

  it("shows the server's message and KEEPS what was typed when it fails", async () => {
    correctActionMock.mockResolvedValue({
      ok: false,
      error: "no-change",
      message: "No hay nada que corregir: las existencias y el costo ya son esos.",
    });
    render(<CorrectStockForm material={BUGGY_PLATA} />);
    type("Motivo", "Sin cambios");

    fireEvent.click(submit());

    expect(await screen.findByRole("alert")).toHaveTextContent("No hay nada que corregir");
    expect(screen.getByLabelText("Motivo")).toHaveValue("Sin cambios");
  });

  it("counts pieces as whole numbers", () => {
    render(
      <CorrectStockForm
        material={{ id: "z", name: "Circones", unit: "pz", stock: 10, avgCost: 500 }}
      />,
    );

    expect(screen.getByLabelText(/^Existencias reales \(pz\)/)).toHaveValue(10);
  });
});
