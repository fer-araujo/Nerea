import { roundTo } from "./round";

// Stock quantities: grams ("g") for metals and alloys, pieces ("pz") for
// stones and miscellany. Both are tracked at a resolution of 0.01 so every
// addition and subtraction is exact (done on integer hundredths) instead of
// accumulating binary floating-point drift over hundreds of movements.
export const MATERIAL_UNITS = ["g", "pz"] as const;
export type MaterialUnit = (typeof MATERIAL_UNITS)[number];

/** Integer hundredths of a unit: 62.35 g -> 6235. */
export function toHundredths(value: number): number {
  return Math.round(roundTo(value, 2) * 100);
}

export function fromHundredths(hundredths: number): number {
  return hundredths / 100;
}

/**
 * Whether `value` can be stored for `unit` without silently losing digits:
 * pieces are whole numbers, grams have at most two decimals. A quantity that
 * fails is REJECTED rather than rounded, so what the admin typed is exactly
 * what the ledger records.
 */
export function hasValidPrecision(unit: MaterialUnit, value: number): boolean {
  if (!Number.isFinite(value)) {
    return false;
  }
  if (unit === "pz") {
    return Number.isInteger(value);
  }
  const scaled = value * 100;
  return Math.abs(scaled - Math.round(scaled)) < 1e-6;
}

// Formatters are hoisted: constructing an Intl.NumberFormat is far more
// expensive than calling format().
const GRAMS_FORMAT = new Intl.NumberFormat("es-MX", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const PIECES_FORMAT = new Intl.NumberFormat("es-MX", {
  maximumFractionDigits: 0,
});
// One formatter per precision, created on first use and reused after that.
const decimalFormats = new Map<number, Intl.NumberFormat>();

/** "71.89 g" — always two decimals, thousands separated. */
export function formatGrams(value: number): string {
  return `${GRAMS_FORMAT.format(value)} g`;
}

export function formatQuantity(value: number, unit: MaterialUnit): string {
  return unit === "pz"
    ? `${PIECES_FORMAT.format(value)} pz`
    : formatGrams(value);
}

/**
 * A plain number with up to `maxDecimals` decimals and no padding, for
 * showing a formula's steps ("71.885", "0.41666", "5").
 */
export function formatDecimal(value: number, maxDecimals = 3): string {
  let format = decimalFormats.get(maxDecimals);
  if (!format) {
    format = new Intl.NumberFormat("es-MX", {
      maximumFractionDigits: maxDecimals,
    });
    decimalFormats.set(maxDecimals, format);
  }
  return format.format(value);
}
