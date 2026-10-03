// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

// The Server Action is mocked: this file covers what the calculator island
// adds on top of it — live results, prefilled defaults, material pickers and
// showing the typed result. The action's own behavior (authorization first,
// zod validation, recomputing, transactions) is in
// tests/admin-inventory-actions.test.ts.
const registerActionMock = vi.fn();
vi.mock("@/app/admin/(panel)/calculadora/actions", () => ({
  registerCastingAction: (...args: unknown[]) => registerActionMock(...args),
}));

import {
  CastingCalculator,
  type CalculatorMaterial,
} from "../app/admin/(panel)/calculadora/CastingCalculator";

const TODAY = "2026-10-02";

const MATERIALS: CalculatorMaterial[] = [
  { id: "silver", name: "Plata fina", kind: "fine_silver", stock: 500 },
  { id: "gold", name: "Oro fino", kind: "fine_gold", stock: 100 },
  { id: "alloy", name: "Liga 14k", kind: "alloy", stock: 50 },
];

function renderCalculator(
  overrides: Partial<Parameters<typeof CastingCalculator>[0]> = {},
) {
  return render(
    <CastingCalculator
      materials={MATERIALS}
      today={TODAY}
      materialsUnavailable={false}
      {...overrides}
    />,
  );
}

const field = (label: string) => screen.getByLabelText(label);
const results = () => within(screen.getByRole("region", { name: "Resultado" }));

function type(label: string, value: string) {
  fireEvent.change(field(label), { target: { value } });
}

function pickGold14k() {
  fireEvent.change(field("Metal y ley"), { target: { value: "gold-14k" } });
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("CastingCalculator: inputs and defaults", () => {
  it("starts on .925 silver with the table's density and fineness and a 10 % allowance", () => {
    renderCalculator();

    expect(field("Metal y ley")).toHaveValue("silver-925");
    expect(field("Densidad (g/cm³)")).toHaveValue(10.4);
    expect(field("Ley (fino de 0 a 1)")).toHaveValue(0.925);
    expect(field("Bebedero (%)")).toHaveValue(10);
    expect(screen.queryByLabelText("Color del oro")).not.toBeInTheDocument();
  });

  it("offers the four metals and, for gold only, the three colors", () => {
    renderCalculator();
    const metals = within(field("Metal y ley")).getAllByRole("option");
    expect(metals.map((option) => option.textContent)).toEqual([
      "Plata .925",
      "Oro 10k",
      "Oro 14k",
      "Oro 18k",
    ]);

    pickGold14k();

    const colors = within(field("Color del oro")).getAllByRole("option");
    expect(colors.map((option) => option.textContent)).toEqual([
      "Amarillo",
      "Blanco",
      "Rojo",
    ]);
  });

  it("refills density and fineness from the table when the metal or color changes", () => {
    renderCalculator();

    pickGold14k();
    expect(field("Densidad (g/cm³)")).toHaveValue(13.07);
    expect(field("Ley (fino de 0 a 1)")).toHaveValue(0.585);

    fireEvent.change(field("Color del oro"), { target: { value: "white" } });
    expect(field("Densidad (g/cm³)")).toHaveValue(12.61);

    fireEvent.change(field("Color del oro"), { target: { value: "red" } });
    expect(field("Densidad (g/cm³)")).toHaveValue(13.26);

    fireEvent.change(field("Metal y ley"), { target: { value: "gold-18k" } });
    expect(field("Densidad (g/cm³)")).toHaveValue(15.18);
    expect(field("Ley (fino de 0 a 1)")).toHaveValue(0.75);
  });

  it("keeps a density the jeweler typed until the metal changes again", () => {
    renderCalculator();
    pickGold14k();

    type("Densidad (g/cm³)", "13.5");
    type("Ley (fino de 0 a 1)", "0.58333");
    expect(field("Densidad (g/cm³)")).toHaveValue(13.5);
    expect(field("Ley (fino de 0 a 1)")).toHaveValue(0.58333);

    fireEvent.change(field("Metal y ley"), { target: { value: "gold-10k" } });
    expect(field("Densidad (g/cm³)")).toHaveValue(11.57);
    expect(field("Ley (fino de 0 a 1)")).toHaveValue(0.41666);
  });
});

describe("CastingCalculator: live results", () => {
  it("asks for the wax weight before showing anything", () => {
    renderCalculator();

    expect(results().getByText(/Escribe el peso de cera/)).toBeInTheDocument();
  });

  it("REQUIRED VECTOR: 5 g of wax in 14k yellow gold -> 71.89 g metal, 42.05 g fine, 29.84 g alloy", () => {
    renderCalculator();
    pickGold14k();

    type("Peso de cera (g)", "5");

    expect(results().getByText("71.89 g")).toBeInTheDocument();
    expect(results().getByText("42.05 g")).toBeInTheDocument();
    expect(results().getByText("29.84 g")).toBeInTheDocument();
  });

  it("updates as the jeweler types, without a submit", () => {
    renderCalculator();

    type("Peso de cera (g)", "5");
    const silverMetal = 5 * 10.4 * 1.1; // 57.2
    expect(results().getByText(`${silverMetal.toFixed(2)} g`)).toBeInTheDocument();

    type("Bebedero (%)", "0");
    expect(results().getByText("52.00 g")).toBeInTheDocument();
  });

  it("shows the recycled metal only when there is some, and deducts it", () => {
    renderCalculator();
    pickGold14k();
    type("Peso de cera (g)", "5");
    expect(results().queryByText("Reciclado")).not.toBeInTheDocument();

    type("Metal reciclado (g)", "20");

    expect(results().getByText("Reciclado")).toBeInTheDocument();
    expect(results().getByText("20.00 g")).toBeInTheDocument();
    expect(results().getByText("30.35 g")).toBeInTheDocument(); // fine
    expect(results().getByText("21.54 g")).toBeInTheDocument(); // alloy
  });

  it("explains the formula in plain words with the jeweler's own numbers, unrounded", () => {
    renderCalculator();
    pickGold14k();
    type("Peso de cera (g)", "5");

    const formula = screen.getByRole("heading", { name: "Cómo se calcula" })
      .parentElement as HTMLElement;
    const text = formula.textContent ?? "";

    expect(text).toContain("peso de cera × densidad × (1 + bebedero)");
    expect(text).toContain("5 g × 13.07 × (1 + 0.1) = 71.885 g");
    expect(text).toContain("(71.885 − 0) × 0.585 = 42.053 g");
    expect(text).toContain("71.89 − 0 − 42.05 = 29.84 g");
    expect(text).toContain("se redondea a 0.01 g");
  });

  it("shows the generic formula without numbers before anything is typed", () => {
    renderCalculator();

    const formula = screen.getByRole("heading", { name: "Cómo se calcula" })
      .parentElement as HTMLElement;
    expect(formula.textContent).toContain("Fino = (metal − reciclado) × ley");
    expect(formula.textContent).not.toMatch(/\d g ×/);
  });

  it("says in plain Spanish why a figure can't be calculated", () => {
    renderCalculator();
    pickGold14k();
    type("Peso de cera (g)", "5");

    type("Metal reciclado (g)", "500");
    expect(
      results().getByText("El metal reciclado no puede ser mayor que el metal total."),
    ).toBeInTheDocument();

    type("Metal reciclado (g)", "");
    type("Densidad (g/cm³)", "0");
    expect(results().getByText("La densidad debe ser mayor que 0.")).toBeInTheDocument();

    type("Densidad (g/cm³)", "13.07");
    type("Ley (fino de 0 a 1)", "1.5");
    expect(
      results().getByText("La ley debe ser mayor que 0 y como máximo 1."),
    ).toBeInTheDocument();
  });

  it("keeps the calculator inputs OUT of the registration form, so Enter can't register a casting", () => {
    renderCalculator();

    for (const label of [
      "Peso de cera (g)",
      "Metal reciclado (g)",
      "Densidad (g/cm³)",
      "Ley (fino de 0 a 1)",
      "Bebedero (%)",
      "Metal y ley",
    ]) {
      expect(field(label).closest("form")).toBeNull();
    }
  });
});

describe("CastingCalculator: registering a casting", () => {
  function fillGoldCasting() {
    pickGold14k();
    type("Peso de cera (g)", "5");
    fireEvent.change(field("Descontar fino de (Oro fino)"), { target: { value: "gold" } });
    fireEvent.change(field("Descontar liga de"), { target: { value: "alloy" } });
  }

  const registerButton = () => screen.getByRole("button", { name: "Registrar vaciado" });

  it("is disabled, with the reason in words, until there is a calculation and the picks", () => {
    renderCalculator();

    expect(registerButton()).toBeDisabled();
    expect(screen.getByText("Completa el cálculo para poder registrarlo.")).toBeInTheDocument();

    pickGold14k();
    type("Peso de cera (g)", "5");
    expect(registerButton()).toBeDisabled();
    expect(
      screen.getByText("Elige el material del que se descuenta el fino."),
    ).toBeInTheDocument();

    fireEvent.change(field("Descontar fino de (Oro fino)"), { target: { value: "gold" } });
    expect(
      screen.getByText("Elige el material del que se descuenta la liga."),
    ).toBeInTheDocument();

    fireEvent.change(field("Descontar liga de"), { target: { value: "alloy" } });
    expect(registerButton()).toBeEnabled();
  });

  it("lists only the fine metal that matches the pour, with the grams on hand", () => {
    renderCalculator();

    // Silver pour: fine SILVER only.
    let fine = within(field("Descontar fino de (Plata fina)")).getAllByRole("option");
    expect(fine.map((option) => option.textContent)).toEqual([
      "Elige un material",
      "Plata fina · 500.00 g",
    ]);

    pickGold14k();
    fine = within(field("Descontar fino de (Oro fino)")).getAllByRole("option");
    expect(fine.map((option) => option.textContent)).toEqual([
      "Elige un material",
      "Oro fino · 100.00 g",
    ]);
    const alloy = within(field("Descontar liga de")).getAllByRole("option");
    expect(alloy.map((option) => option.textContent)).toEqual([
      "Elige un material",
      "Liga 14k · 50.00 g",
    ]);
  });

  it("forgets a fine-metal pick that no longer applies when the pour changes family", () => {
    renderCalculator();
    fireEvent.change(field("Descontar fino de (Plata fina)"), { target: { value: "silver" } });

    pickGold14k();

    expect(field("Descontar fino de (Oro fino)")).toHaveValue("");
  });

  it("says how much will be taken, and blocks registering when the stock is short", () => {
    renderCalculator({
      materials: [
        { id: "gold", name: "Oro fino", kind: "fine_gold", stock: 10 },
        { id: "alloy", name: "Liga 14k", kind: "alloy", stock: 50 },
      ],
    });
    fillGoldCasting();

    expect(screen.getByText("Necesitas 42.05 g y solo hay 10.00 g.")).toBeInTheDocument();
    expect(screen.getByText("Se descontarán 29.84 g.")).toBeInTheDocument();
    expect(registerButton()).toBeDisabled();
    expect(
      screen.getByText(/Las existencias no alcanzan/),
    ).toBeInTheDocument();
  });

  it("explains how to get the materials when there are none to pick from", () => {
    renderCalculator({ materials: [] });

    expect(screen.getByText(/necesitas un material de/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Inventario" })).toHaveAttribute(
      "href",
      "/admin/inventario",
    );
    expect(screen.getByRole("link", { name: "Inversiones" })).toHaveAttribute(
      "href",
      "/admin/inversiones",
    );
  });

  it("says so when the materials could not be loaded, yet still calculates", () => {
    renderCalculator({ materials: [], materialsUnavailable: true });

    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos cargar tus materiales");
    type("Peso de cera (g)", "5");
    expect(results().getByText("57.20 g")).toBeInTheDocument();
  });

  it("posts the RAW inputs and the picks, never the computed figures", async () => {
    registerActionMock.mockResolvedValue({ ok: true });
    renderCalculator();
    fillGoldCasting();
    type("Metal reciclado (g)", "2.5");
    fireEvent.change(field("Nota (opcional)"), { target: { value: "Anillo de prueba" } });

    fireEvent.click(registerButton());

    await waitFor(() => expect(registerActionMock).toHaveBeenCalledTimes(1));
    const [formData] = registerActionMock.mock.calls[0] as [FormData];
    expect(Object.fromEntries(formData.entries())).toEqual({
      metal: "gold-14k",
      color: "yellow",
      waxGrams: "5",
      density: "13.07",
      fineness: "0.585",
      allowancePercent: "10",
      recycledGrams: "2.5",
      fineMaterialId: "gold",
      alloyMaterialId: "alloy",
      date: TODAY,
      note: "Anillo de prueba",
    });
  });

  it("omits the color for silver", async () => {
    registerActionMock.mockResolvedValue({ ok: true });
    renderCalculator();
    type("Peso de cera (g)", "5");
    fireEvent.change(field("Descontar fino de (Plata fina)"), { target: { value: "silver" } });
    fireEvent.change(field("Descontar liga de"), { target: { value: "alloy" } });

    fireEvent.click(registerButton());

    await waitFor(() => expect(registerActionMock).toHaveBeenCalledTimes(1));
    const [formData] = registerActionMock.mock.calls[0] as [FormData];
    expect(formData.get("metal")).toBe("silver-925");
    expect(formData.has("color")).toBe(false);
  });

  it("confirms success and clears the casting, ready for the next one", async () => {
    registerActionMock.mockResolvedValue({ ok: true });
    renderCalculator();
    fillGoldCasting();

    fireEvent.click(registerButton());

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Vaciado registrado. Las existencias se actualizaron.",
    );
    expect(field("Peso de cera (g)")).toHaveValue(null);
    expect(field("Descontar fino de (Oro fino)")).toHaveValue("");
    expect(field("Descontar liga de")).toHaveValue("");
    // The metal stays selected: the next pour is probably the same metal.
    expect(field("Metal y ley")).toHaveValue("gold-14k");
  });

  it("shows the server's message and KEEPS what was typed when it fails", async () => {
    registerActionMock.mockResolvedValue({
      ok: false,
      error: "insufficient-stock",
      message: "Las existencias no alcanzan para esta operación.",
    });
    renderCalculator();
    fillGoldCasting();

    fireEvent.click(registerButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Las existencias no alcanzan para esta operación.",
    );
    expect(field("Peso de cera (g)")).toHaveValue(5);
    expect(field("Descontar fino de (Oro fino)")).toHaveValue("gold");
    // The button is back so the jeweler can simply try again.
    await waitFor(() => expect(registerButton()).toBeEnabled());
  });

  it("shows a generic message when the request itself fails", async () => {
    registerActionMock.mockRejectedValue(new Error("network down"));
    renderCalculator();
    fillGoldCasting();

    fireEvent.click(registerButton());

    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo guardar");
    expect(screen.getByRole("alert")).not.toHaveTextContent("network down");
  });
});
