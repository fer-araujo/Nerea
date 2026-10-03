// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// The Server Action is mocked: this file covers what the form island adds on
// top of it — the live total and margin, the "Calcular metal" helper and the
// typed result. The action's own behavior (authorization first, zod
// validation, the write) is in tests/admin-pieces-sales-actions.test.ts.
const saveActionMock = vi.fn();
vi.mock("@/app/admin/(panel)/piezas/actions", () => ({
  savePieceCostAction: (...args: unknown[]) => saveActionMock(...args),
}));

import {
  PieceCostForm,
  type PieceCostMaterial,
  type PieceCostValues,
} from "../app/admin/(panel)/piezas/PieceCostForm";

const EMPTY: PieceCostValues = {
  metal: "",
  stones: "",
  other: "",
  labor: "",
  metalGrams: "",
  materialId: "",
  note: "",
};

const MATERIALS: PieceCostMaterial[] = [
  { id: "silver", name: "Plata fina", avgCost: 1800 }, // $18.00 / g
  { id: "alloy", name: "Liga", avgCost: 400 }, // $4.00 / g
];

function renderForm(
  overrides: Partial<{
    price: number;
    initial: PieceCostValues;
    materials: PieceCostMaterial[];
    materialsUnavailable: boolean;
  }> = {},
) {
  return render(
    <PieceCostForm
      handle="anillo-luna"
      title="Anillo Luna"
      price={overrides.price ?? 400_000}
      initial={overrides.initial ?? EMPTY}
      materials={overrides.materials ?? MATERIALS}
      materialsUnavailable={overrides.materialsUnavailable ?? false}
    />,
  );
}

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const calculateButton = () => screen.getByRole("button", { name: "Calcular metal" });
const submitButton = () => screen.getByRole("button", { name: "Guardar costo" });
const total = () => screen.getByText("Costo total").parentElement;

beforeEach(() => {
  vi.resetAllMocks();
});

describe("PieceCostForm: what it shows", () => {
  it("names the piece and its catalog price, and posts the handle", () => {
    const { container } = renderForm();

    expect(screen.getByText("Anillo Luna")).toBeInTheDocument();
    expect(screen.getByText("Precio en la tienda: $4,000.00")).toBeInTheDocument();
    expect(container.querySelector('input[name="handle"]')).toHaveValue("anillo-luna");
  });

  it("starts with the saved values", () => {
    renderForm({
      initial: {
        metal: "1000.00",
        stones: "300.00",
        other: "0.00",
        labor: "150.00",
        metalGrams: "12.5",
        materialId: "silver",
        note: "Con piedra",
      },
    });

    expect(screen.getByLabelText("Metal (MXN)")).toHaveValue(1000);
    expect(screen.getByLabelText("Mano de obra (MXN, opcional)")).toHaveValue(150);
    expect(screen.getByLabelText("Gramos de metal")).toHaveValue(12.5);
    expect(screen.getByLabelText("Material")).toHaveValue("silver");
    expect(screen.getByLabelText("Nota (opcional)")).toHaveValue("Con piedra");
  });
});

describe("PieceCostForm: live total and margin", () => {
  it("asks for costs before it shows a margin", () => {
    renderForm();

    expect(total()).toHaveTextContent("$0.00");
    expect(screen.getByText("Escribe los costos para ver la utilidad de la pieza.")).toBeInTheDocument();
    expect(screen.queryByText("Utilidad")).not.toBeInTheDocument();
  });

  it("adds metal, stones, other and labor, and shows the margin against the price", () => {
    renderForm();

    type("Metal (MXN)", "1000");
    type("Piedras (MXN)", "300");
    type("Otros (MXN)", "50.50");
    type("Mano de obra (MXN, opcional)", "149.50");

    // 1000 + 300 + 50.50 + 149.50 = $1,500.00 against a $4,000.00 price.
    expect(total()).toHaveTextContent("$1,500.00");
    expect(screen.getByText("Utilidad").parentElement).toHaveTextContent("$2,500.00 · 62.5 %");
  });

  it("shows a loss when the cost is above the price", () => {
    renderForm({ price: 100_000 });

    type("Metal (MXN)", "1300");

    expect(screen.getByText("Utilidad").parentElement).toHaveTextContent("-$300.00 · -30.0 %");
  });

  it("ignores an amount that is not yet valid instead of showing garbage", () => {
    renderForm();

    type("Metal (MXN)", "10.555");

    expect(total()).toHaveTextContent("$0.00");
  });

  it("shows no percentage for a piece with no price", () => {
    renderForm({ price: 0 });

    type("Metal (MXN)", "10");

    const utilidad = screen.getByText("Utilidad").parentElement;
    expect(utilidad).toHaveTextContent("-$10.00");
    expect(utilidad).not.toHaveTextContent("%");
  });
});

describe("PieceCostForm: Calcular metal", () => {
  it("is off until a material AND a valid number of grams are chosen", () => {
    renderForm();
    expect(calculateButton()).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Material"), { target: { value: "silver" } });
    expect(calculateButton()).toBeDisabled();

    type("Gramos de metal", "0");
    expect(calculateButton()).toBeDisabled();

    type("Gramos de metal", "12.5");
    expect(calculateButton()).toBeEnabled();
  });

  it("fills the metal field with grams x the material's average cost per gram", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText("Material"), { target: { value: "silver" } });
    type("Gramos de metal", "12.5");

    fireEvent.click(calculateButton());

    // 12.5 g x $18.00 / g = $225.00
    expect(screen.getByLabelText("Metal (MXN)")).toHaveValue(225);
    expect(total()).toHaveTextContent("$225.00");
  });

  it("rounds to the centavo, half up", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText("Material"), { target: { value: "silver" } });
    type("Gramos de metal", "3.333");

    fireEvent.click(calculateButton());

    // 3.333 g x 1800 c = 5999.4 c -> $59.99
    expect(screen.getByLabelText("Metal (MXN)")).toHaveValue(59.99);
  });

  it("is only a suggestion: the field stays editable and the grams stay on the form", () => {
    const { container } = renderForm();
    fireEvent.change(screen.getByLabelText("Material"), { target: { value: "alloy" } });
    type("Gramos de metal", "10");
    fireEvent.click(calculateButton());
    expect(screen.getByLabelText("Metal (MXN)")).toHaveValue(40);

    type("Metal (MXN)", "55");

    expect(screen.getByLabelText("Metal (MXN)")).toHaveValue(55);
    expect(total()).toHaveTextContent("$55.00");
    expect(container.querySelector('select[name="materialId"]')).toHaveValue("alloy");
    expect(container.querySelector('input[name="metalGrams"]')).toHaveValue(10);
  });

  it("says which average cost it uses once a material is chosen", () => {
    renderForm();

    fireEvent.change(screen.getByLabelText("Material"), { target: { value: "silver" } });

    expect(screen.getByText(/costo promedio por gramo del material \(\$18\.00 \/ g\)/)).toBeInTheDocument();
  });

  it("lists each material with its cost per gram", () => {
    renderForm();

    const labels = screen
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(labels).toEqual([
      "Elige un material",
      "Plata fina · $18.00 / g",
      "Liga · $4.00 / g",
    ]);
  });

  it("explains how to get a material when there are none, without the helper's controls", () => {
    renderForm({ materials: [] });

    expect(screen.getByText(/Crea un material de plata, oro o liga en Inventario/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Calcular metal" })).not.toBeInTheDocument();
    // The metal field still works by hand.
    type("Metal (MXN)", "10");
    expect(total()).toHaveTextContent("$10.00");
  });

  it("says so, and keeps the metal field working, when the materials could not be read", () => {
    renderForm({ materials: [], materialsUnavailable: true });

    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos cargar tus materiales");
    expect(screen.queryByRole("button", { name: "Calcular metal" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Metal (MXN)")).toBeEnabled();
  });

  it.each([
    ["there are no materials", { materials: [], materialsUnavailable: false }],
    ["the materials could not be read", { materials: [], materialsUnavailable: true }],
  ])(
    "does not erase the grams and material saved earlier when %s (a save replaces the whole record)",
    async (_label, props) => {
      saveActionMock.mockResolvedValue({ ok: true });
      renderForm({
        ...props,
        initial: { ...EMPTY, metal: "225.00", metalGrams: "12.5", materialId: "silver" },
      });

      fireEvent.click(submitButton());

      await waitFor(() => expect(saveActionMock).toHaveBeenCalledTimes(1));
      const [formData] = saveActionMock.mock.calls[0] as [FormData];
      expect(formData.get("metalGrams")).toBe("12.5");
      expect(formData.get("materialId")).toBe("silver");
    },
  );
});

describe("PieceCostForm: saving", () => {
  function fillCosts() {
    fireEvent.change(screen.getByLabelText("Material"), { target: { value: "silver" } });
    type("Gramos de metal", "12.5");
    fireEvent.click(calculateButton());
    type("Piedras (MXN)", "300");
    type("Otros (MXN)", "");
    type("Mano de obra (MXN, opcional)", "150");
    type("Nota (opcional)", "Con piedra");
  }

  it("posts every field, the handle included", async () => {
    saveActionMock.mockResolvedValue({ ok: true });
    renderForm();
    fillCosts();

    fireEvent.click(submitButton());

    await waitFor(() => expect(saveActionMock).toHaveBeenCalledTimes(1));
    const [formData] = saveActionMock.mock.calls[0] as [FormData];
    expect(Object.fromEntries(formData.entries())).toEqual({
      handle: "anillo-luna",
      metal: "225.00",
      stones: "300",
      other: "",
      labor: "150",
      metalGrams: "12.5",
      materialId: "silver",
      note: "Con piedra",
    });
  });

  it("confirms success and KEEPS the values: it edits a saved record, it does not clear", async () => {
    saveActionMock.mockResolvedValue({ ok: true });
    renderForm();
    fillCosts();

    fireEvent.click(submitButton());

    expect(await screen.findByRole("status")).toHaveTextContent("Costo guardado.");
    expect(screen.getByLabelText("Metal (MXN)")).toHaveValue(225);
    expect(screen.getByLabelText("Nota (opcional)")).toHaveValue("Con piedra");
  });

  it("shows the server's message and keeps what was typed when it fails", async () => {
    saveActionMock.mockResolvedValue({
      ok: false,
      error: "invalid",
      message: "Costos: escribe al menos un costo (puede ser 0).",
    });
    renderForm();
    type("Nota (opcional)", "Algo");

    fireEvent.click(submitButton());

    expect(await screen.findByRole("alert")).toHaveTextContent("escribe al menos un costo");
    expect(screen.getByLabelText("Nota (opcional)")).toHaveValue("Algo");
    await waitFor(() => expect(submitButton()).toBeEnabled());
  });

  it("shows a generic message when the request itself fails, without leaking its error", async () => {
    saveActionMock.mockRejectedValue(new Error("network down"));
    renderForm();

    fireEvent.click(submitButton());

    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo guardar");
    expect(screen.getByRole("alert")).not.toHaveTextContent("network down");
  });

  it("disables the form while saving, so it cannot be double-submitted", async () => {
    let finish: (value: { ok: true }) => void = () => undefined;
    saveActionMock.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    renderForm();

    fireEvent.click(submitButton());

    expect(await screen.findByRole("button", { name: "Guardando…" })).toBeDisabled();
    fireEvent.submit(
      screen.getByRole("button", { name: "Guardando…" }).closest("form") as HTMLFormElement,
    );
    expect(saveActionMock).toHaveBeenCalledTimes(1);

    finish({ ok: true });
    expect(await screen.findByRole("status")).toBeInTheDocument();
  });
});
