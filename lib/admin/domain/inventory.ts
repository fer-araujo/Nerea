import { METAL_PRESETS, type MetalKey } from "./casting";
import { isCentavos, weightedAverageCost } from "./money";
import {
  fromHundredths,
  hasValidPrecision,
  toHundredths,
  type MaterialUnit,
} from "./quantity";
import { roundTo } from "./round";

// The rules of the materials ledger, as pure functions. The Firestore layer
// (lib/admin/data) only reads the current state, calls these, and writes the
// result inside a transaction, so every rule is unit-tested without a
// database.

export const MATERIAL_KINDS = [
  "fine_silver",
  "fine_gold",
  "alloy",
  "stone",
  "other",
] as const;
export type MaterialKind = (typeof MATERIAL_KINDS)[number];

export const MOVEMENT_TYPES = [
  "purchase",
  "casting",
  "adjustment",
  "loss",
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

// A manual correction: "adjustment" may add or remove, "loss" (merma) only
// removes. Purchases and castings are written by their own flows, never typed.
export const ADJUSTMENT_KINDS = ["adjustment", "loss"] as const;
export type AdjustmentKind = (typeof ADJUSTMENT_KINDS)[number];

/** One purchase can span several materials; this bounds the transaction. */
export const MAX_PURCHASE_ITEMS = 25;

export type InventoryErrorCode =
  | "invalid-quantity"
  | "invalid-cost"
  | "insufficient-stock"
  | "material-not-found"
  | "invalid-material";

/**
 * A ledger rule was broken. The `code` is the contract: server actions turn
 * it into a typed result, so nothing about the underlying failure (or any
 * stored value) has to travel to the browser.
 */
export class InventoryError extends Error {
  readonly code: InventoryErrorCode;

  constructor(code: InventoryErrorCode, message: string = code) {
    super(message);
    this.name = "InventoryError";
    this.code = code;
  }
}

export interface StockState {
  /** Units on hand, a multiple of 0.01. */
  stock: number;
  /** Average cost, integer centavos per unit. */
  avgCost: number;
}

function assertQuantity(
  unit: MaterialUnit,
  value: number,
  rule: "positive" | "non-zero",
): void {
  const valid =
    hasValidPrecision(unit, value) &&
    (rule === "positive" ? value > 0 : value !== 0);
  if (!valid) {
    throw new InventoryError("invalid-quantity");
  }
}

/**
 * A purchase: adds `qty` and re-averages the cost. The ONLY operation that
 * changes avgCost.
 */
export function receiveStock(
  state: StockState,
  unit: MaterialUnit,
  qty: number,
  totalCost: number,
): StockState {
  assertQuantity(unit, qty, "positive");
  if (!isCentavos(totalCost)) {
    throw new InventoryError("invalid-cost");
  }

  return {
    stock: fromHundredths(toHundredths(state.stock) + toHundredths(qty)),
    avgCost: weightedAverageCost({
      stock: state.stock,
      avgCost: state.avgCost,
      qty,
      totalCost,
    }),
  };
}

/**
 * A signed change (a casting consumes, a correction adds or removes). Never
 * touches avgCost, and never lets stock go below zero: the whole operation is
 * refused instead.
 */
export function moveStock(
  state: StockState,
  unit: MaterialUnit,
  delta: number,
): StockState {
  assertQuantity(unit, delta, "non-zero");

  const next = toHundredths(state.stock) + toHundredths(delta);
  if (next < 0) {
    throw new InventoryError("insufficient-stock");
  }

  return { stock: fromHundredths(next), avgCost: state.avgCost };
}

/** Consumes a positive `qty` (a casting's fine metal or alloy). */
export function consumeStock(
  state: StockState,
  unit: MaterialUnit,
  qty: number,
): StockState {
  assertQuantity(unit, qty, "positive");
  return moveStock(state, unit, -qty);
}

/**
 * What a movement was worth at `unitCost`, integer centavos. Costs in the
 * ledger are magnitudes — the sign of a movement lives in its `qty` alone.
 */
export function movementValue(unitCost: number, qty: number): number {
  return roundTo(Math.abs(qty) * unitCost);
}

/**
 * The material kind a casting's fine metal must come from: silver pours draw
 * fine silver, gold pours fine gold.
 */
export function fineKindFor(metal: MetalKey): "fine_silver" | "fine_gold" {
  return METAL_PRESETS[metal].family === "gold" ? "fine_gold" : "fine_silver";
}
