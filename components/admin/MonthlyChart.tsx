"use client";

import dynamic from "next/dynamic";
import { useId, useState } from "react";
import { formatMXN } from "@/lib/admin/domain/money";
import { cn } from "@/lib/cn";
import { LABEL_CLASS, NUMBER_CLASS, QUIET_BUTTON_CLASS } from "./styles";

/** One month of the chart. Money is integer centavos. */
export interface MonthlyChartPoint {
  /** "2026-10" */
  key: string;
  /** Short, for the axis: "oct 26". */
  label: string;
  /** Long, for the table and the written summary: "octubre de 2026". */
  longLabel: string;
  sales: number;
  investments: number;
  grossProfit: number;
}

// recharts is loaded on demand and never on the server: the KPI cards render
// and hydrate without waiting for it, and a chart library has no business in
// the server render. The placeholder holds the chart's height so nothing jumps
// when it arrives.
const MonthlyBarsCanvas = dynamic(() => import("./MonthlyBarsCanvas"), {
  ssr: false,
  loading: () => (
    <div aria-hidden="true" className="h-72 w-full bg-bone-sunk sm:h-80" />
  ),
});

const TH_CLASS = cn(LABEL_CLASS, "px-3 py-3 font-normal first:pl-0 last:pr-0");
const TD_CLASS = "px-3 py-3 align-top first:pl-0 last:pr-0";

// What a person who cannot see the chart needs to know about it, in one
// sentence: the span, the totals, the best month and where the rest is.
function chartSummary(points: readonly MonthlyChartPoint[]): string {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) {
    return "Gráfica mensual de ventas, inversiones y utilidad bruta. Aún no hay meses para mostrar.";
  }

  let sales = 0;
  let investments = 0;
  let grossProfit = 0;
  let best = first;
  for (const point of points) {
    sales += point.sales;
    investments += point.investments;
    grossProfit += point.grossProfit;
    if (point.sales > best.sales) {
      best = point;
    }
  }

  const bestMonth =
    best.sales > 0
      ? `El mes con más ventas fue ${best.longLabel}, con ${formatMXN(best.sales)}.`
      : "No hubo ventas en estos meses.";

  return (
    `Gráfica mensual de ${first.longLabel} a ${last.longLabel}, con barras de ventas e inversiones y una línea de utilidad bruta. ` +
    `En total: ventas ${formatMXN(sales)}, inversiones ${formatMXN(investments)} y utilidad bruta ${formatMXN(grossProfit)}. ` +
    `${bestMonth} Usa «Ver como tabla» para ver las cifras de cada mes.`
  );
}

// The SAME points as the chart, as a table. A scroll region (not a layout
// squeeze) keeps the columns legible at 360px; tabIndex lets keyboard users
// scroll it.
function MonthlyTable({ points }: { points: readonly MonthlyChartPoint[] }) {
  return (
    <div
      role="region"
      aria-label="Tabla de los últimos 12 meses"
      tabIndex={0}
      className="overflow-x-auto border-y border-line"
    >
      <table className="w-full min-w-[30rem] border-collapse text-left">
        <caption className="sr-only">
          Ventas, inversiones y utilidad bruta de cada uno de los últimos 12
          meses
        </caption>
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className={TH_CLASS}>
              Mes
            </th>
            <th scope="col" className={cn(TH_CLASS, "text-right")}>
              Ventas
            </th>
            <th scope="col" className={cn(TH_CLASS, "text-right")}>
              Inversiones
            </th>
            <th scope="col" className={cn(TH_CLASS, "text-right")}>
              Utilidad bruta
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {points.map((point) => (
            <tr key={point.key}>
              <th
                scope="row"
                className={cn(TD_CLASS, "font-sans text-sm font-normal text-ink")}
              >
                {point.longLabel}
              </th>
              <td className={cn(TD_CLASS, NUMBER_CLASS, "text-right text-sm text-ink")}>
                {formatMXN(point.sales)}
              </td>
              <td className={cn(TD_CLASS, NUMBER_CLASS, "text-right text-sm text-ink")}>
                {formatMXN(point.investments)}
              </td>
              <td
                className={cn(
                  TD_CLASS,
                  NUMBER_CLASS,
                  "text-right text-sm",
                  point.grossProfit < 0 ? "text-garnet" : "text-ink",
                )}
              >
                {formatMXN(point.grossProfit)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// The last twelve months, as a chart or — one click away — as the same numbers
// in a table. The chart is an image to assistive tech, so its aria-label
// carries the summary and the table is the way to read every month.
export function MonthlyChart({
  points,
}: {
  points: readonly MonthlyChartPoint[];
}) {
  const [showTable, setShowTable] = useState(false);
  const viewId = useId();

  return (
    <figure>
      <div className="flex flex-wrap items-center justify-between gap-x-4">
        <figcaption className={LABEL_CLASS}>Últimos 12 meses</figcaption>
        <button
          type="button"
          aria-controls={viewId}
          onClick={() => setShowTable((current) => !current)}
          className={QUIET_BUTTON_CLASS}
        >
          {showTable ? "Ver como gráfica" : "Ver como tabla"}
        </button>
      </div>

      <div id={viewId} className="mt-2">
        {showTable ? (
          <MonthlyTable points={points} />
        ) : (
          <div role="img" aria-label={chartSummary(points)}>
            <MonthlyBarsCanvas points={points} />
          </div>
        )}
      </div>
    </figure>
  );
}
