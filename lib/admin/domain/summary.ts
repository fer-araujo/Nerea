// The Resumen (summary) dashboard, as pure functions: the KPIs of a period, the
// last twelve months for the chart, the value of the inventory and the piece
// counts. No I/O, so it is safe in a client bundle too; the Firestore layer
// (lib/admin/data/summary.ts) reads the documents and hands them to these.
//
// Money is ALWAYS integer centavos. A "month" is a Mexico City month: it
// starts when the 1st begins THERE, not in UTC (on Netlify, which runs in UTC,
// 21:00 on the 30th in Mexico City is already the 1st).

import { inventoryValue } from "./money";
import {
  firstOfMonth,
  mexicoToday,
  startOfMexicoDay,
  type CivilDate,
  type PeriodRange,
} from "./periods";
import { roundTo } from "./round";
import { summarizeSales, type SaleFigures } from "./sales";

/** Months in the chart: the current one and the eleven before it. */
export const SUMMARY_MONTHS = 12;

/** The figures of one sale that the dashboard needs, plus when it happened. */
export interface SummarySale extends SaleFigures {
  /** The business date; `null` for a document whose date can't be read. */
  date: Date | null;
}

export interface SummaryPurchase {
  /** The business date; `null` for a document whose date can't be read. */
  date: Date | null;
  /** What the purchase cost in total, integer centavos. */
  totalCost: number;
}

/** First-of-month civil dates of the chart, oldest first, current month last. */
function chartMonths(now: Date): CivilDate[] {
  const { year, month } = mexicoToday(now);
  return Array.from({ length: SUMMARY_MONTHS }, (_, index) =>
    firstOfMonth(year, month - (SUMMARY_MONTHS - 1 - index)),
  );
}

/**
 * The range the dashboard reads, ONCE, to serve everything on the page: the
 * selected period AND the twelve months of the chart. Reading it once keeps the
 * KPI cards and the chart consistent (this month's card IS the last bar) and
 * costs one query per collection instead of one per widget. "This year" can
 * reach past the chart's last month, hence the union.
 */
export function ledgerWindow(period: PeriodRange, now: Date): PeriodRange {
  const months = chartMonths(now);
  const first = months[0];
  const last = months[months.length - 1];

  const chartStart = startOfMexicoDay(first);
  const chartEnd = startOfMexicoDay(firstOfMonth(last.year, last.month + 1));

  return {
    start: period.start.getTime() < chartStart.getTime() ? period.start : chartStart,
    end: period.end.getTime() > chartEnd.getTime() ? period.end : chartEnd,
  };
}

function within(range: PeriodRange, date: Date | null): boolean {
  if (date === null) {
    return false;
  }
  const time = date.getTime();
  return time >= range.start.getTime() && time < range.end.getTime();
}

/**
 * Gross profit as a percentage OF SALES, one decimal (a 1000 sale with a 600
 * cost is 40). `null` when nothing was sold: there is nothing to divide by.
 * Negative when the cost is above the sales.
 */
export function marginPercent(
  sales: number,
  grossProfit: number,
): number | null {
  return sales > 0 ? roundTo((grossProfit / sales) * 100, 1) : null;
}

export interface PeriodKpis {
  /** Sales that count (voided ones do not). */
  salesCount: number;
  voidedCount: number;
  /**
   * Ventas: what the pieces sold for. Shipping is NOT in it, as in the Ventas
   * page: the flat fee is a pass-through, and counting it as revenue would
   * inflate the profit.
   */
  sales: number;
  /** Costo de lo vendido, as frozen on each sale when it was recorded. */
  costOfGoods: number;
  /** Utilidad bruta: sales - costOfGoods. Negative when it cost more. */
  grossProfit: number;
  marginPercent: number | null;
  /** Inversiones: what was spent on materials. */
  investments: number;
  purchaseCount: number;
  /** Flujo: sales - investments. Negative when more went out than came in. */
  cashFlow: number;
  /** Counted sales whose cost was still unknown when they were recorded. */
  pendingCostCount: number;
}

/**
 * The KPIs of `range`, in one pass over what was read. A voided sale is left
 * out of every figure (and only counted in `voidedCount`); a document with no
 * readable date belongs to no period. The sales rule is `summarizeSales`, the
 * same one the Ventas page totals with, so the two can never disagree.
 */
export function periodKpis(
  sales: readonly SummarySale[],
  purchases: readonly SummaryPurchase[],
  range: PeriodRange,
): PeriodKpis {
  const totals = summarizeSales(sales.filter((sale) => within(range, sale.date)));

  let investments = 0;
  let purchaseCount = 0;
  for (const purchase of purchases) {
    if (within(range, purchase.date)) {
      investments += purchase.totalCost;
      purchaseCount += 1;
    }
  }

  return {
    salesCount: totals.count,
    voidedCount: totals.voidedCount,
    sales: totals.subtotal,
    costOfGoods: totals.costOfGoods,
    grossProfit: totals.grossProfit,
    marginPercent: marginPercent(totals.subtotal, totals.grossProfit),
    investments,
    purchaseCount,
    cashFlow: totals.subtotal - investments,
    pendingCostCount: totals.pendingCount,
  };
}

export interface MonthBucket {
  /** "2026-10": the Mexico City month. */
  key: string;
  year: number;
  /** 1-12 */
  month: number;
  /** The instant the month begins in Mexico City. */
  start: Date;
  /** Ventas of the month: voided sales left out, shipping apart. */
  sales: number;
  costOfGoods: number;
  /** sales - costOfGoods */
  grossProfit: number;
  /** Inversiones of the month. */
  investments: number;
}

function monthKey(year: number, month: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

// The month an INSTANT falls in, in Mexico City. `mexicoToday` takes any
// instant, not only "now".
function monthKeyOf(instant: Date): string {
  const { year, month } = mexicoToday(instant);
  return monthKey(year, month);
}

/**
 * The last twelve Mexico City months, oldest first and ending with the month
 * of `now`, EMPTY months included (a gap in the chart is information, a
 * missing bar is not). Anything outside those months, a voided sale, or a
 * document with no readable date is left out.
 */
export function monthlyBuckets(
  sales: readonly SummarySale[],
  purchases: readonly SummaryPurchase[],
  now: Date = new Date(),
): MonthBucket[] {
  const buckets: MonthBucket[] = chartMonths(now).map(({ year, month }) => ({
    key: monthKey(year, month),
    year,
    month,
    start: startOfMexicoDay({ year, month, day: 1 }),
    sales: 0,
    costOfGoods: 0,
    grossProfit: 0,
    investments: 0,
  }));
  const byKey = new Map(buckets.map((bucket) => [bucket.key, bucket] as const));

  for (const sale of sales) {
    if (sale.status === "void" || sale.date === null) {
      continue;
    }
    const bucket = byKey.get(monthKeyOf(sale.date));
    if (bucket) {
      bucket.sales += sale.subtotal;
      bucket.costOfGoods += sale.costOfGoods;
    }
  }

  for (const purchase of purchases) {
    if (purchase.date === null) {
      continue;
    }
    const bucket = byKey.get(monthKeyOf(purchase.date));
    if (bucket) {
      bucket.investments += purchase.totalCost;
    }
  }

  for (const bucket of buckets) {
    bucket.grossProfit = bucket.sales - bucket.costOfGoods;
  }
  return buckets;
}

/**
 * What the materials on hand are worth, integer centavos: the sum of each
 * material's stock x average cost, each rounded to the centavo through the
 * same `inventoryValue` the Inventario page values every row with (so the
 * page's total and this one always agree). Nothing on hand is worth 0.
 */
export function inventoryTotal(
  materials: ReadonlyArray<{ stock: number; avgCost: number }>,
): number {
  return materials.reduce(
    (sum, material) => sum + inventoryValue(material.stock, material.avgCost),
    0,
  );
}

export interface PieceCounts {
  available: number;
  sold: number;
}

/**
 * Pieces still on the shelf and pieces sold. Anything but the literal
 * "available" counts as sold, as in the catalog: a doubtful piece must never
 * look sellable.
 */
export function countPieces(
  products: ReadonlyArray<{ availability: string }>,
): PieceCounts {
  let available = 0;
  for (const product of products) {
    if (product.availability === "available") {
      available += 1;
    }
  }
  return { available, sold: products.length - available };
}
