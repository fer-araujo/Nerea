import { roundTo } from "./round";

// Money is ALWAYS integer centavos, the same unit as `Money.amount` in
// lib/commerce/types.ts. A peso amount only exists at the edges: parsed from a
// form field (pesosToCentavos) and shown to the admin (formatMXN).

export function isCentavos(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

/**
 * Pesos typed in a form -> integer centavos, rounding half up at the centavo.
 * (The form schema already refuses more than two decimals; the rounding here
 * only absorbs binary noise such as 1234.56 * 100 = 123456.00000000001.)
 */
export function pesosToCentavos(pesos: number): number {
  return roundTo(pesos * 100);
}

/** Cost of ONE unit from a purchase line: whole-centavo, rounded half up. */
export function unitCostFromTotal(totalCost: number, qty: number): number {
  if (!(qty > 0) || !Number.isFinite(qty)) {
    throw new RangeError("qty must be a positive number");
  }
  if (!isCentavos(totalCost)) {
    throw new RangeError("totalCost must be an integer number of centavos");
  }
  return roundTo(totalCost / qty);
}

export interface WeightedAverageInput {
  /** Units on hand BEFORE the purchase. */
  stock: number;
  /** Current average cost, integer centavos per unit. */
  avgCost: number;
  /** Units bought. */
  qty: number;
  /** What the units cost in total, integer centavos. */
  totalCost: number;
}

/**
 * New average cost per unit after a purchase:
 *
 *   ((stock x avgCost) + totalCost) / (stock + qty)
 *
 * in integer centavos per unit, rounded half up (explicitly, through
 * `roundTo`, never left to the engine). With nothing on hand (stock <= 0) the
 * old average no longer means anything, so the new one is simply
 * totalCost / qty.
 */
export function weightedAverageCost({
  stock,
  avgCost,
  qty,
  totalCost,
}: WeightedAverageInput): number {
  if (!Number.isFinite(stock)) {
    throw new RangeError("stock must be a finite number");
  }
  if (!(qty > 0) || !Number.isFinite(qty)) {
    throw new RangeError("qty must be a positive number");
  }
  if (!isCentavos(totalCost)) {
    throw new RangeError("totalCost must be an integer number of centavos");
  }
  if (!isCentavos(avgCost)) {
    throw new RangeError("avgCost must be an integer number of centavos");
  }

  if (stock <= 0) {
    return roundTo(totalCost / qty);
  }
  return roundTo((stock * avgCost + totalCost) / (stock + qty));
}

/** Value of what is on hand, integer centavos. Nothing on hand is worth 0. */
export function inventoryValue(stock: number, avgCost: number): number {
  return stock > 0 ? roundTo(stock * avgCost) : 0;
}

const MXN_FORMAT = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
});

/** 123456 -> "$1,234.56" */
export function formatMXN(centavos: number): string {
  return MXN_FORMAT.format(centavos / 100);
}
