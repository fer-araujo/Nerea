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
  "correction",
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

// A manual adjustment: "adjustment" (a physical count) may add or remove,
// "loss" (merma) only removes. Purchases and castings are written by their own
// flows, never typed; a "correction" is its own operation (planCorrection).
export const ADJUSTMENT_KINDS = ["adjustment", "loss"] as const;
export type AdjustmentKind = (typeof ADJUSTMENT_KINDS)[number];

/** One purchase can span several materials; this bounds the transaction. */
export const MAX_PURCHASE_ITEMS = 25;

/**
 * The concept of the purchase that carries a new material's opening stock
 * (see createMaterial). Such a purchase is flagged `initial` and is left out of
 * the period's investments and cash flow: what she already owned was not spent
 * this month.
 */
export const INITIAL_PURCHASE_CONCEPT = "Inventario inicial";

export type InventoryErrorCode =
  | "invalid-quantity"
  | "invalid-cost"
  | "insufficient-stock"
  | "material-not-found"
  | "invalid-material"
  | "no-change";

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

/**
 * A manual adjustment ("Ajustar"). A negative `delta` (a loss, or a count that
 * came up short) removes stock and never touches the average. A positive one
 * brings units into the ledger, so it MUST say what they cost: it is priced like
 * a purchase of `delta` units at `unitCost` and the average is re-weighted. Never
 * "free": units added at an implicit cost of 0 are what once halved a material's
 * average and doubled its stock after the real purchase was registered too.
 *
 * Throws InventoryError: "invalid-quantity" (zero, wrong precision, or a "loss"
 * that isn't negative), "invalid-cost" (a positive delta with no valid unit
 * cost), "insufficient-stock" (would go below zero).
 */
export function applyAdjustment(
  state: StockState,
  unit: MaterialUnit,
  kind: AdjustmentKind,
  delta: number,
  unitCost?: number,
): StockState {
  if (kind === "loss" && !(delta < 0)) {
    throw new InventoryError("invalid-quantity");
  }
  if (delta < 0) {
    return moveStock(state, unit, delta);
  }

  assertQuantity(unit, delta, "positive");
  if (unitCost === undefined || !isCentavos(unitCost)) {
    throw new InventoryError("invalid-cost");
  }
  return receiveStock(state, unit, delta, movementValue(unitCost, delta));
}

export interface StockCorrection extends StockState {
  /** Signed change from the current stock to `stock`, in the unit. */
  delta: number;
}

/**
 * "Corregir": the admin states the REAL stock and the REAL average cost and the
 * ledger is brought to them (the way out of a wrong average, which a purchase or
 * an adjustment can only dilute). Returns the new state plus the signed `delta`
 * to record on the movement. Zero stock is allowed.
 *
 * Throws InventoryError: "invalid-quantity" (negative, or wrong precision for
 * the unit), "invalid-cost" (not integer centavos), "no-change" (both values
 * already match: nothing to record).
 */
export function planCorrection(
  current: StockState,
  unit: MaterialUnit,
  target: StockState,
): StockCorrection {
  if (!hasValidPrecision(unit, target.stock) || target.stock < 0) {
    throw new InventoryError("invalid-quantity");
  }
  if (!isCentavos(target.avgCost)) {
    throw new InventoryError("invalid-cost");
  }

  const stockHundredths = toHundredths(target.stock);
  const delta = fromHundredths(stockHundredths - toHundredths(current.stock));
  if (delta === 0 && target.avgCost === current.avgCost) {
    throw new InventoryError("no-change");
  }

  return {
    stock: fromHundredths(stockHundredths),
    avgCost: target.avgCost,
    delta,
  };
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
