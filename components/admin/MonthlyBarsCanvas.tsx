"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatMXN } from "@/lib/admin/domain/money";
import type { MonthlyChartPoint } from "./MonthlyChart";

// The recharts half of the monthly chart, split out so MonthlyChart can load it
// lazily (next/dynamic, no SSR): the library is the heaviest thing on the page
// and the KPI cards, which matter first, must not wait for it. Nothing else
// imports this file, or recharts.
//
// Colors are the panel's own tokens (CSS variables from app/globals.css, which
// SVG paint attributes accept): ink bars for what came in, graphite for what
// went out, brass for the profit line. They are not the only cue — the series
// also differ in SHAPE (two sets of bars and a marked line), are named in the
// legend, and the same numbers are one click away as a table.
const INK = "var(--ink)";
const GRAPHITE = "var(--graphite)";
const BRASS = "var(--brass-deep)";
const LINE = "var(--line)";

const AXIS_TICK = { fill: GRAPHITE, fontSize: 11 } as const;

const TOOLTIP_STYLE = {
  background: "var(--bone-raised)",
  border: `1px solid ${LINE}`,
  borderRadius: 0,
  boxShadow: "none",
  fontSize: 12,
} as const;

// Hoisted: building a NumberFormat is the expensive part. Compact so the axis
// stays narrow on a 360px phone ("$12 mil" instead of "$12,000.00").
const AXIS_FORMAT = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  notation: "compact",
  maximumFractionDigits: 1,
});

function axisPesos(centavos: number): string {
  return AXIS_FORMAT.format(centavos / 100);
}

function tooltipAmount(value: unknown): string {
  return typeof value === "number" ? formatMXN(value) : String(value ?? "");
}

export default function MonthlyBarsCanvas({
  points,
}: {
  points: readonly MonthlyChartPoint[];
}) {
  return (
    <div className="h-72 w-full sm:h-80">
      <ResponsiveContainer width="100%" height="100%">
        {/* No keyboard layer and no animation: the wrapper around this chart
            is an image with a written summary, the table view is the
            accessible way in, and the global reduced-motion rule cannot stop
            a JavaScript animation. */}
        <ComposedChart
          data={[...points]}
          margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
          accessibilityLayer={false}
        >
          <CartesianGrid vertical={false} stroke={LINE} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={{ stroke: LINE }}
            tick={AXIS_TICK}
            minTickGap={4}
          />
          <YAxis
            width={56}
            tickLine={false}
            axisLine={false}
            tick={AXIS_TICK}
            tickFormatter={axisPesos}
          />
          <ReferenceLine y={0} stroke={GRAPHITE} />
          <Tooltip
            cursor={{ fill: "var(--bone-sunk)" }}
            contentStyle={TOOLTIP_STYLE}
            labelFormatter={(label, payload) => {
              const point = payload?.[0]?.payload as
                | Partial<MonthlyChartPoint>
                | undefined;
              return point?.longLabel ?? label;
            }}
            formatter={(value) => tooltipAmount(value)}
          />
          <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
          <Bar
            dataKey="sales"
            name="Ventas"
            fill={INK}
            maxBarSize={16}
            isAnimationActive={false}
          />
          <Bar
            dataKey="investments"
            name="Inversiones"
            fill={GRAPHITE}
            maxBarSize={16}
            isAnimationActive={false}
          />
          {/* A straight line between months: a curve would invent values
              between two real ones. */}
          <Line
            dataKey="grossProfit"
            name="Utilidad bruta"
            type="linear"
            stroke={BRASS}
            strokeWidth={2}
            dot={{ r: 3, fill: BRASS, stroke: BRASS }}
            activeDot={{ r: 5 }}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
