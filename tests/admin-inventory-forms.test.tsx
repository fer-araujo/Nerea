// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// The Server Actions are mocked: this file covers what the two form islands
// add on top of them — what they post, the kind -> unit suggestion, and
// showing the typed result. The actions' own behavior (authorization first,
// zod validation, transactions) is in tests/admin-inventory-actions.test.ts.
const createActionMock = vi.fn();
const adjustActionMock = vi.fn();
vi.mock("@/app/admin/(panel)/inventario/actions", () => ({
  createMaterialAction: (...args: unknown[]) => createActionMock(...args),
  adjustStockAction: (...args: unknown[]) => adjustActionMock(...args),
}));

import {
  AdjustStockForm,
  type AdjustableMaterial,
} from "../app/admin/(panel)/inventario/AdjustStockForm";
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

  it("tells the jeweler that stock arrives through a purchase", () => {
    render(<CreateMaterialForm />);

    expect(screen.getByText(/empieza en 0/)).toBeInTheDocument();
  });

  it("posts the name, kind and unit", async () => {
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
    });
  });

  it("confirms success and clears the form", async () => {
    createActionMock.mockResolvedValue({ ok: true });
    render(<CreateMaterialForm />);
    fireEvent.change(nameField(), { target: { value: "Plata fina" } });
    fireEvent.change(screen.getByLabelText("Tipo"), { target: { value: "stone" } });

    fireEvent.click(submit());

    expect(await screen.findByRole("status")).toHaveTextContent("Material creado.");
    expect(nameField()).toHaveValue("");
    expect(screen.getByLabelText("Tipo")).toHaveValue("fine_silver");
    expect(screen.getByLabelText("Unidad")).toHaveValue("g");
  });

  it("shows the server's message and KEEPS what was typed when it fails", async () => {
    createActionMock.mockResolvedValue({
      ok: false,
      error: "invalid",
      message: "Nombre: es obligatorio.",
    });
    render(<CreateMaterialForm />);
    fireEvent.change(nameField(), { target: { value: "x" } });

    fireEvent.click(submit());

    expect(await screen.findByRole("alert")).toHaveTextContent("Nombre: es obligatorio.");
    expect(nameField()).toHaveValue("x");
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
  const MATERIALS: AdjustableMaterial[] = [
    { id: "silver", name: "Plata fina", unit: "g" },
    { id: "stones", name: "Circones", unit: "pz" },
  ];
  const submit = () => screen.getByRole("button", { name: "Ajustar existencias" });

  function fillAdjustment() {
    fireEvent.change(screen.getByLabelText("Material"), { target: { value: "silver" } });
    fireEvent.change(screen.getByLabelText(/^Cantidad/), { target: { value: "-2.5" } });
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "Conteo físico" } });
  }

  it("asks for a material first when there are none to adjust", () => {
    render(<AdjustStockForm materials={[]} />);

    expect(screen.getByText(/Crea un material/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ajustar existencias" })).not.toBeInTheDocument();
  });

  it("offers a correction and a loss, and explains how to subtract", () => {
    render(<AdjustStockForm materials={MATERIALS} />);

    expect(
      within(screen.getByLabelText("Tipo")).getAllByRole("option").map((option) => option.textContent),
    ).toEqual(["Corrección (suma o resta)", "Merma (solo resta)"]);
    // The hint is wired to the quantity field for assistive tech.
    expect(screen.getByLabelText(/^Cantidad/)).toHaveAccessibleDescription(
      /Usa un número negativo para restar/,
    );
  });

  it("shows the unit of the chosen material in the quantity label", () => {
    render(<AdjustStockForm materials={MATERIALS} />);
    expect(screen.getByText("Cantidad")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Material"), { target: { value: "silver" } });
    expect(screen.getByText("Cantidad (g)")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Material"), { target: { value: "stones" } });
    expect(screen.getByText("Cantidad (pz)")).toBeInTheDocument();
  });

  it("posts the material, the signed quantity, the kind and the reason", async () => {
    adjustActionMock.mockResolvedValue({ ok: true });
    render(<AdjustStockForm materials={MATERIALS} />);
    fillAdjustment();
    fireEvent.change(screen.getByLabelText("Tipo"), { target: { value: "loss" } });

    fireEvent.click(submit());

    await waitFor(() => expect(adjustActionMock).toHaveBeenCalledTimes(1));
    const [formData] = adjustActionMock.mock.calls[0] as [FormData];
    expect(Object.fromEntries(formData.entries())).toEqual({
      materialId: "silver",
      delta: "-2.5",
      kind: "loss",
      reason: "Conteo físico",
    });
  });

  it("confirms success and clears the form", async () => {
    adjustActionMock.mockResolvedValue({ ok: true });
    render(<AdjustStockForm materials={MATERIALS} />);
    fillAdjustment();

    fireEvent.click(submit());

    expect(await screen.findByRole("status")).toHaveTextContent("Existencias ajustadas.");
    expect(screen.getByLabelText("Material")).toHaveValue("");
    expect(screen.getByLabelText(/^Cantidad/)).toHaveValue(null);
    expect(screen.getByLabelText("Motivo")).toHaveValue("");
  });

  it("shows the server's message and KEEPS what was typed when it fails", async () => {
    adjustActionMock.mockResolvedValue({
      ok: false,
      error: "insufficient-stock",
      message: "Las existencias no alcanzan para esta operación.",
    });
    render(<AdjustStockForm materials={MATERIALS} />);
    fillAdjustment();

    fireEvent.click(submit());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Las existencias no alcanzan para esta operación.",
    );
    expect(screen.getByLabelText("Material")).toHaveValue("silver");
    expect(screen.getByLabelText(/^Cantidad/)).toHaveValue(-2.5);
    expect(screen.getByLabelText("Motivo")).toHaveValue("Conteo físico");
    await waitFor(() => expect(submit()).toBeEnabled());
  });

  it("shows a generic message when the request itself fails", async () => {
    adjustActionMock.mockRejectedValue(new Error("network down"));
    render(<AdjustStockForm materials={MATERIALS} />);
    fillAdjustment();

    fireEvent.click(submit());

    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo guardar");
    expect(screen.getByRole("alert")).not.toHaveTextContent("network down");
  });
});
