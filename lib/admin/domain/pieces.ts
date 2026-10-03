import { movementValue } from "./inventory";
import { roundTo } from "./round";

// The cost side of a piece, as pure functions. A piece is a one-of-one item, so
// its cost is entered by hand (and by the "Calcular metal" helper) rather than
// derived from stock: the Firestore layer (lib/admin/data/pieces.ts) only
// stores what these rules produce and reads back.
//
// Money is ALWAYS integer centavos, like everywhere in lib/admin.

export interface PieceCosts {
  metal: number;
  stones: number;
  other: number;
  /** Optional: a piece made entirely by the jeweler may carry no labor cost. */
  labor?: number;
}

/** Everything the piece cost to make, integer centavos. */
export function pieceCostTotal(costs: PieceCosts): number {
  return costs.metal + costs.stones + costs.other + (costs.labor ?? 0);
}

export interface PieceMargin {
  /** Price minus cost, integer centavos. Negative when it sells below cost. */
  margin: number;
  /**
   * The margin as a percentage OF THE PRICE, one decimal (a 4000 price with a
   * 1000 cost is 75). `null` for a piece with no price: nothing to divide by.
   */
  marginPercent: number | null;
}

export function pieceMargin(price: number, cost: number): PieceMargin {
  const margin = price - cost;
  return {
    margin,
    marginPercent: price > 0 ? roundTo((margin / price) * 100, 1) : null,
  };
}

/**
 * "Calcular metal": what `grams` of a material are worth at its CURRENT
 * average cost per gram (integer centavos), rounded half up at the centavo.
 * The same rule that values every ledger movement, so a piece's metal cost
 * and the inventory it came out of can never disagree. The result is only a
 * suggestion for the form: the admin may still change it.
 */
export function metalCostFromGrams(
  grams: number,
  avgCostPerGram: number,
): number {
  if (!(grams > 0) || !Number.isFinite(grams)) {
    throw new RangeError("grams must be a positive number");
  }
  if (!Number.isSafeInteger(avgCostPerGram) || avgCostPerGram < 0) {
    throw new RangeError("avgCostPerGram must be integer centavos");
  }
  return movementValue(avgCostPerGram, grams);
}

// Hoisted: constructing an Intl.NumberFormat is far more expensive than
// calling format().
const PERCENT_FORMAT = new Intl.NumberFormat("es-MX", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** 42.5 -> "42.5 %". */
export function formatPercent(value: number): string {
  return `${PERCENT_FORMAT.format(value)} %`;
}
