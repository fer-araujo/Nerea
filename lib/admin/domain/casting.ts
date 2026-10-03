import { roundTo } from "./round";

// Lost-wax casting math. Pure and dependency-free so the calculator page can
// run it live in the browser while the server re-runs the exact same code when
// a casting is registered (the client's numbers are never trusted).

export const METAL_KEYS = [
  "silver-925",
  "gold-10k",
  "gold-14k",
  "gold-18k",
] as const;
export type MetalKey = (typeof METAL_KEYS)[number];

export const GOLD_COLORS = ["yellow", "white", "red"] as const;
export type GoldColor = (typeof GOLD_COLORS)[number];

export const GOLD_COLOR_LABELS: Readonly<Record<GoldColor, string>> = {
  yellow: "Amarillo",
  white: "Blanco",
  red: "Rojo",
};

interface SilverPreset {
  family: "silver";
  label: string;
  /** Fraction of fine metal in the alloy (0.925 = 925 per mille). */
  fineness: number;
  /** g/cm3 */
  density: number;
}

interface GoldPreset {
  family: "gold";
  label: string;
  fineness: number;
  /** g/cm3 — gold alloys differ by color because the alloying metals do. */
  densityByColor: Readonly<Record<GoldColor, number>>;
}

export type MetalPreset = SilverPreset | GoldPreset;

/**
 * The alloy table. These are DEFAULTS: the calculator prefills them and the
 * jeweler can overwrite fineness and density at the moment of use (her master
 * alloy or supplier may differ), and the values actually used are stored with
 * each registered casting.
 *
 * Densities are the usual supplier figures (Stuller). Fineness follows
 * NOM-033/1-SE-2020.
 */
export const METAL_PRESETS: Readonly<Record<MetalKey, MetalPreset>> = {
  "silver-925": {
    family: "silver",
    label: "Plata .925",
    fineness: 0.925,
    density: 10.4,
  },
  "gold-10k": {
    family: "gold",
    label: "Oro 10k",
    // NOM: 416.66 per mille (the 10/24 ratio is 0.41666...).
    fineness: 0.41666,
    densityByColor: { yellow: 11.57, white: 11.07, red: 11.59 },
  },
  "gold-14k": {
    family: "gold",
    label: "Oro 14k",
    // Trade practice (hallmarks, suppliers) is 585 per mille. The nominal
    // 14/24 is 0.58333 — type that in at use time to cast to the nominal.
    fineness: 0.585,
    densityByColor: { yellow: 13.07, white: 12.61, red: 13.26 },
  },
  "gold-18k": {
    family: "gold",
    label: "Oro 18k",
    fineness: 0.75,
    densityByColor: { yellow: 15.58, white: 14.64, red: 15.18 },
  },
};

/** Extra metal poured for the sprue and button (botón / bebedero): +10 %. */
export const DEFAULT_ALLOWANCE = 0.1;
// A sanity ceiling, not a recommendation: 100 % would double the metal.
export const MAX_ALLOWANCE = 1;

export function isGoldMetal(key: MetalKey): boolean {
  return METAL_PRESETS[key].family === "gold";
}

/** Prefill values for a metal (color only matters for gold). */
export function defaultsFor(
  key: MetalKey,
  color: GoldColor = "yellow",
): { fineness: number; density: number } {
  const preset = METAL_PRESETS[key];
  return {
    fineness: preset.fineness,
    density:
      preset.family === "gold" ? preset.densityByColor[color] : preset.density,
  };
}

export type CastingField =
  | "waxGrams"
  | "density"
  | "allowance"
  | "fineness"
  | "metalGrams"
  | "recycledGrams";

export type CastingErrorCode =
  | "not-a-number"
  | "not-positive"
  | "out-of-range"
  | "recycled-exceeds-metal";

/**
 * A casting input that cannot be calculated. Carries WHICH field and WHY so
 * the UI can speak to the jeweler in her language (see lib/admin/copy.ts);
 * the English message is for developers and logs.
 */
export class CastingInputError extends Error {
  readonly field: CastingField;
  readonly code: CastingErrorCode;

  constructor(field: CastingField, code: CastingErrorCode, message: string) {
    super(message);
    this.name = "CastingInputError";
    this.field = field;
    this.code = code;
  }
}

function requireNumber(field: CastingField, value: number): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new CastingInputError(
      field,
      "not-a-number",
      `${field} must be a finite number`,
    );
  }
}

function requirePositive(field: CastingField, value: number): void {
  requireNumber(field, value);
  if (!(value > 0)) {
    throw new CastingInputError(
      field,
      "not-positive",
      `${field} must be greater than 0`,
    );
  }
}

/**
 * Metal needed to cast a wax model:
 *
 *   metal = wax x density x (1 + allowance)
 *
 * `density` is the alloy's (g/cm3): the wax is replaced by the same VOLUME of
 * metal, and the allowance adds the sprue and button. Returned UNROUNDED on
 * purpose — splitAlloy() rounds once, at the end, so the fine and alloy
 * figures aren't built on an already-rounded total.
 */
export function metalFromWax(
  waxGrams: number,
  density: number,
  allowance: number = DEFAULT_ALLOWANCE,
): number {
  requirePositive("waxGrams", waxGrams);
  requirePositive("density", density);
  requireNumber("allowance", allowance);
  if (allowance < 0 || allowance > MAX_ALLOWANCE) {
    throw new CastingInputError(
      "allowance",
      "out-of-range",
      `allowance must be between 0 and ${MAX_ALLOWANCE}`,
    );
  }

  return waxGrams * density * (1 + allowance);
}

export interface AlloySplit {
  /** Total metal to cast, rounded to 0.01 g. */
  metal: number;
  /** Fine metal to weigh, rounded to 0.01 g. */
  fine: number;
  /** Alloying metal (liga) to weigh: whatever is left. */
  alloy: number;
  /** Recycled metal (sprues, scrap) going into the same pour, 0.01 g. */
  recycled: number;
}

function centigrams(grams: number): number {
  return Math.round(roundTo(grams, 2) * 100);
}

/**
 * Splits the metal for a pour into what to weigh out:
 *
 *   fine  = (metal - recycled) x fineness
 *   alloy = metal - recycled - fine
 *
 * Everything is rounded to 0.01 g, and the sum is done on integer
 * centigrams so that fine + alloy + recycled equals the rounded metal
 * EXACTLY — the alloy is deliberately the remainder, never rounded on its
 * own. `fine` comes from the unrounded figures (71.885 g x 0.585 = 42.05 g,
 * not 71.89 x 0.585 = 42.06), which is what keeps the rounded total and the
 * two weighed amounts consistent.
 *
 * Recycled metal is compared at the same 0.01 g resolution as the total, so
 * typing exactly the metal figure the calculator displays is never "more
 * than the metal".
 */
export function splitAlloy(
  metalGrams: number,
  fineness: number,
  recycledGrams = 0,
): AlloySplit {
  requirePositive("metalGrams", metalGrams);
  requireNumber("fineness", fineness);
  if (!(fineness > 0) || fineness > 1) {
    throw new CastingInputError(
      "fineness",
      "out-of-range",
      "fineness must be greater than 0 and at most 1",
    );
  }
  requireNumber("recycledGrams", recycledGrams);
  if (recycledGrams < 0) {
    throw new CastingInputError(
      "recycledGrams",
      "out-of-range",
      "recycledGrams must not be negative",
    );
  }

  const metalCg = centigrams(metalGrams);
  const recycledCg = centigrams(recycledGrams);
  if (recycledCg > metalCg) {
    throw new CastingInputError(
      "recycledGrams",
      "recycled-exceeds-metal",
      "recycledGrams must not exceed the metal",
    );
  }

  const newMetalCg = metalCg - recycledCg;
  // Rounding metal and recycled separately can leave `newMetalCg` a hundredth
  // below the unrounded difference, so cap the fine at what is available: it
  // can never push the alloy negative.
  const fineCg = Math.min(
    centigrams(Math.max(metalGrams - recycledGrams, 0) * fineness),
    newMetalCg,
  );

  return {
    metal: metalCg / 100,
    fine: fineCg / 100,
    alloy: (newMetalCg - fineCg) / 100,
    recycled: recycledCg / 100,
  };
}

export interface CastingInput {
  waxGrams: number;
  density: number;
  fineness: number;
  /** Fraction, 0.10 = 10 %. */
  allowance?: number;
  recycledGrams?: number;
}

/** metalFromWax() then splitAlloy(): everything the pour needs. */
export function calculateCasting(input: CastingInput): AlloySplit {
  const metal = metalFromWax(input.waxGrams, input.density, input.allowance);
  return splitAlloy(metal, input.fineness, input.recycledGrams ?? 0);
}

export type CastingCalculation =
  | { ok: true; value: AlloySplit }
  | { ok: false; error: CastingInputError };

/**
 * calculateCasting() for live UI: incomplete or invalid input is an expected
 * state while someone types, so it comes back as a value instead of a throw.
 * Anything that is not a CastingInputError is a bug and still throws.
 */
export function safeCalculateCasting(input: CastingInput): CastingCalculation {
  try {
    return { ok: true, value: calculateCasting(input) };
  } catch (error) {
    if (error instanceof CastingInputError) {
      return { ok: false, error };
    }
    throw error;
  }
}
