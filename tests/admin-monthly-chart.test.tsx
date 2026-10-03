// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

// recharts draws into a box it measures (ResponsiveContainer), and jsdom has no
// layout engine: its drawing is the library's job, not ours. So the lazy
// wrapper and the canvas are stand-ins that show what they were handed, and
// what is under test is what is OURS: the written summary, the table with the
// same numbers, and the toggle between them.
vi.mock("next/dynamic", async () => {
  // createElement, not JSX: this factory runs before the file's own imports.
  const React = await import("react");
  return {
    default: () =>
      function BarsCanvasStub({ points }: { points: ReadonlyArray<{ key: string }> }) {
        return React.createElement(
          "div",
          { "data-testid": "bars-canvas" },
          `${points.length} meses`,
        );
      },
  };
});

import { MonthlyChart, type MonthlyChartPoint } from "@/components/admin/MonthlyChart";

const MONTHS = [
  "noviembre de 2025",
  "diciembre de 2025",
  "enero de 2026",
  "febrero de 2026",
  "marzo de 2026",
  "abril de 2026",
  "mayo de 2026",
  "junio de 2026",
  "julio de 2026",
  "agosto de 2026",
  "septiembre de 2026",
  "octubre de 2026",
];

function twelveMonths(
  overrides: Record<number, Partial<MonthlyChartPoint>> = {},
): MonthlyChartPoint[] {
  return MONTHS.map((longLabel, index) => ({
    key: `m${index}`,
    label: `m${index}`,
    longLabel,
    sales: 0,
    investments: 0,
    grossProfit: 0,
    ...overrides[index],
  }));
}

const BUSY_YEAR = twelveMonths({
  3: { sales: 200_000, investments: 50_000, grossProfit: 120_000 },
  11: { sales: 100_000, investments: 150_000, grossProfit: -30_000 },
});

describe("MonthlyChart", () => {
  it("shows the chart first, as an image with a written summary", () => {
    render(<MonthlyChart points={BUSY_YEAR} />);

    const chart = screen.getByRole("img");
    expect(within(chart).getByTestId("bars-canvas")).toHaveTextContent("12 meses");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();

    const summary = chart.getAttribute("aria-label") ?? "";
    expect(summary).toContain("de noviembre de 2025 a octubre de 2026");
    // 200_000 + 100_000, 50_000 + 150_000 and 120_000 - 30_000, in centavos.
    expect(summary).toContain("ventas $3,000.00");
    expect(summary).toContain("inversiones $2,000.00");
    expect(summary).toContain("utilidad bruta $900.00");
    expect(summary).toContain("El mes con más ventas fue febrero de 2026, con $2,000.00.");
    expect(summary).toContain("Ver como tabla");
  });

  it("offers the table through a button that names what it does", () => {
    render(<MonthlyChart points={BUSY_YEAR} />);

    expect(screen.getByRole("button", { name: "Ver como tabla" })).toBeInTheDocument();
    expect(screen.getByText("Últimos 12 meses")).toBeInTheDocument();
  });

  it("swaps the chart for a table of the SAME numbers when asked", () => {
    render(<MonthlyChart points={BUSY_YEAR} />);

    fireEvent.click(screen.getByRole("button", { name: "Ver como tabla" }));

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByTestId("bars-canvas")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ver como gráfica" })).toBeInTheDocument();

    const table = screen.getByRole("table", {
      name: /Ventas, inversiones y utilidad bruta de cada uno de los últimos 12 meses/,
    });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual(["Mes", "Ventas", "Inversiones", "Utilidad bruta"]);
    // One header row and the twelve months, empty ones included.
    expect(within(table).getAllByRole("row")).toHaveLength(13);

    const february = within(table).getByRole("row", { name: /febrero de 2026/ });
    expect(within(february).getByText("$2,000.00")).toBeInTheDocument();
    expect(within(february).getByText("$500.00")).toBeInTheDocument();
    expect(within(february).getByText("$1,200.00")).toBeInTheDocument();

    const october = within(table).getByRole("row", { name: /octubre de 2026/ });
    expect(within(october).getByText("$1,000.00")).toBeInTheDocument();
    expect(within(october).getByText("$1,500.00")).toBeInTheDocument();
  });

  it("marks a month with a loss in red, and the minus sign says it too", () => {
    render(<MonthlyChart points={BUSY_YEAR} />);
    fireEvent.click(screen.getByRole("button", { name: "Ver como tabla" }));

    const october = screen.getByRole("row", { name: /octubre de 2026/ });
    expect(within(october).getByText("-$300.00")).toHaveClass("text-garnet");

    const february = screen.getByRole("row", { name: /febrero de 2026/ });
    expect(within(february).getByText("$1,200.00")).not.toHaveClass("text-garnet");
  });

  it("goes back to the chart with the second click", () => {
    render(<MonthlyChart points={BUSY_YEAR} />);

    fireEvent.click(screen.getByRole("button", { name: "Ver como tabla" }));
    fireEvent.click(screen.getByRole("button", { name: "Ver como gráfica" }));

    expect(screen.getByRole("img")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ver como tabla" })).toBeInTheDocument();
  });

  it("points the button at the element that holds the current view", () => {
    render(<MonthlyChart points={BUSY_YEAR} />);
    const button = screen.getByRole("button", { name: "Ver como tabla" });
    const targetId = button.getAttribute("aria-controls") ?? "";

    expect(targetId).not.toBe("");
    expect(document.getElementById(targetId)).toContainElement(screen.getByRole("img"));

    fireEvent.click(button);

    expect(document.getElementById(targetId)).toContainElement(screen.getByRole("table"));
  });

  it("makes the table a labelled, keyboard-scrollable region for a narrow screen", () => {
    render(<MonthlyChart points={BUSY_YEAR} />);
    fireEvent.click(screen.getByRole("button", { name: "Ver como tabla" }));

    const region = screen.getByRole("region", { name: "Tabla de los últimos 12 meses" });

    expect(region).toHaveAttribute("tabindex", "0");
    expect(region).toHaveClass("overflow-x-auto");
  });

  it("says so in the summary when no month had any sale", () => {
    render(<MonthlyChart points={twelveMonths()} />);

    const summary = screen.getByRole("img").getAttribute("aria-label") ?? "";

    expect(summary).toContain("No hubo ventas en estos meses.");
    expect(summary).not.toContain("El mes con más ventas");
    expect(summary).toContain("ventas $0.00");
  });

  it("copes with no months at all", () => {
    render(<MonthlyChart points={[]} />);

    expect(screen.getByRole("img").getAttribute("aria-label")).toContain(
      "Aún no hay meses para mostrar",
    );

    fireEvent.click(screen.getByRole("button", { name: "Ver como tabla" }));
    expect(screen.getAllByRole("row")).toHaveLength(1);
  });
});
