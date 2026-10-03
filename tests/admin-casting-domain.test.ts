import { describe, expect, it } from "vitest";
import {
  CastingInputError,
  DEFAULT_ALLOWANCE,
  METAL_KEYS,
  METAL_PRESETS,
  calculateCasting,
  defaultsFor,
  isGoldMetal,
  metalFromWax,
  safeCalculateCasting,
  splitAlloy,
} from "@/lib/admin/domain/casting";

// Integer centigrams: the only way to ask "is this sum EXACT" without
// floating-point slack.
const cg = (grams: number) => Math.round(grams * 100);

// Deterministic PRNG so the property test is reproducible.
function mulberry32(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("alloy table", () => {
  it("holds the agreed fineness and densities", () => {
    expect(METAL_PRESETS["silver-925"]).toMatchObject({
      family: "silver",
      fineness: 0.925,
      density: 10.4,
    });
    expect(METAL_PRESETS["gold-10k"]).toMatchObject({
      family: "gold",
      fineness: 0.41666,
      densityByColor: { yellow: 11.57, white: 11.07, red: 11.59 },
    });
    expect(METAL_PRESETS["gold-14k"]).toMatchObject({
      family: "gold",
      fineness: 0.585,
      densityByColor: { yellow: 13.07, white: 12.61, red: 13.26 },
    });
    expect(METAL_PRESETS["gold-18k"]).toMatchObject({
      family: "gold",
      fineness: 0.75,
      densityByColor: { yellow: 15.58, white: 14.64, red: 15.18 },
    });
  });

  it("defaults the sprue allowance to 10 %", () => {
    expect(DEFAULT_ALLOWANCE).toBe(0.1);
  });

  it("has a preset for every metal key", () => {
    for (const key of METAL_KEYS) {
      expect(METAL_PRESETS[key].label.length).toBeGreaterThan(0);
    }
  });

  it("prefills fineness and density, by color for gold only", () => {
    expect(defaultsFor("silver-925")).toEqual({ fineness: 0.925, density: 10.4 });
    // Color is irrelevant to silver.
    expect(defaultsFor("silver-925", "red")).toEqual({
      fineness: 0.925,
      density: 10.4,
    });
    expect(defaultsFor("gold-14k", "yellow")).toEqual({
      fineness: 0.585,
      density: 13.07,
    });
    expect(defaultsFor("gold-14k", "white").density).toBe(12.61);
    expect(defaultsFor("gold-18k", "red").density).toBe(15.18);
    // Yellow is the default color.
    expect(defaultsFor("gold-10k").density).toBe(11.57);
  });

  it("tells gold from silver", () => {
    expect(isGoldMetal("silver-925")).toBe(false);
    expect(isGoldMetal("gold-14k")).toBe(true);
  });
});

describe("metalFromWax", () => {
  it("is wax x density x (1 + allowance), unrounded", () => {
    expect(metalFromWax(5, 13.07, 0.1)).toBeCloseTo(71.885, 10);
    expect(metalFromWax(10, 10.4, 0)).toBeCloseTo(104, 10);
    expect(metalFromWax(2, 10, 0.5)).toBeCloseTo(30, 10);
  });

  it("applies the default 10 % allowance when none is given", () => {
    expect(metalFromWax(5, 13.07)).toBe(metalFromWax(5, 13.07, 0.1));
  });

  it.each([
    ["zero wax", () => metalFromWax(0, 13.07), "waxGrams", "not-positive"],
    ["negative wax", () => metalFromWax(-1, 13.07), "waxGrams", "not-positive"],
    ["NaN wax", () => metalFromWax(Number.NaN, 13.07), "waxGrams", "not-a-number"],
    ["infinite wax", () => metalFromWax(Infinity, 13.07), "waxGrams", "not-a-number"],
    ["zero density", () => metalFromWax(5, 0), "density", "not-positive"],
    ["negative density", () => metalFromWax(5, -2), "density", "not-positive"],
    ["NaN density", () => metalFromWax(5, Number.NaN), "density", "not-a-number"],
    ["negative allowance", () => metalFromWax(5, 13, -0.01), "allowance", "out-of-range"],
    ["allowance over 100 %", () => metalFromWax(5, 13, 1.01), "allowance", "out-of-range"],
    ["NaN allowance", () => metalFromWax(5, 13, Number.NaN), "allowance", "not-a-number"],
  ])("rejects %s", (_label, run, field, code) => {
    expect(run).toThrow(CastingInputError);
    try {
      run();
    } catch (error) {
      expect(error).toMatchObject({ field, code });
    }
  });

  it("accepts the boundaries of the allowance", () => {
    expect(() => metalFromWax(5, 13, 0)).not.toThrow();
    expect(() => metalFromWax(5, 13, 1)).not.toThrow();
  });
});

describe("splitAlloy", () => {
  it("REQUIRED VECTOR: 67.4 g of .925 silver -> fine 62.35, alloy 5.05", () => {
    expect(splitAlloy(67.4, 0.925)).toEqual({
      metal: 67.4,
      fine: 62.35,
      alloy: 5.05,
      recycled: 0,
    });
  });

  it("REQUIRED VECTOR: 5 g of wax in 14k yellow -> metal 71.89, fine 42.05, alloy 29.84", () => {
    const metal = metalFromWax(5, 13.07, 0.1);

    expect(splitAlloy(metal, 0.585)).toEqual({
      metal: 71.89,
      fine: 42.05,
      alloy: 29.84,
      recycled: 0,
    });
  });

  it("the same vector through calculateCasting with the table's own defaults", () => {
    const { fineness, density } = defaultsFor("gold-14k", "yellow");

    expect(
      calculateCasting({ waxGrams: 5, density, fineness, allowance: 0.1 }),
    ).toEqual({ metal: 71.89, fine: 42.05, alloy: 29.84, recycled: 0 });
  });

  it("rounds ties the way a person does, not the way binary floating point does", () => {
    // 62.345 is stored as 62.345000000000006 and 71.885 / 0.285 / 1.005 sit
    // just below their decimal value: all must round UP.
    expect(splitAlloy(67.4, 0.925).fine).toBe(62.35);
    expect(splitAlloy(71.885, 1).metal).toBe(71.89);
    expect(splitAlloy(0.285, 1).metal).toBe(0.29);
    expect(splitAlloy(1.005, 1).metal).toBe(1.01);
  });

  it("deducts recycled metal before applying the fineness", () => {
    // New metal to weigh = 100 - 20 = 80; fine = 80 x 0.925 = 74, alloy = 6.
    expect(splitAlloy(100, 0.925, 20)).toEqual({
      metal: 100,
      fine: 74,
      alloy: 6,
      recycled: 20,
    });
  });

  it("needs no new metal when everything is recycled", () => {
    expect(splitAlloy(50, 0.925, 50)).toEqual({
      metal: 50,
      fine: 0,
      alloy: 0,
      recycled: 50,
    });
  });

  it("accepts recycled metal equal to the DISPLAYED (rounded) metal", () => {
    // 71.885 is shown as 71.89; typing 71.89 as the recycled amount must not
    // count as "more than the metal".
    expect(splitAlloy(71.885, 0.585, 71.89)).toEqual({
      metal: 71.89,
      fine: 0,
      alloy: 0,
      recycled: 71.89,
    });
  });

  it("never lets the fine exceed what is left, so the alloy is never negative", () => {
    // Rounded separately, 10.004 and 5.005 leave 4.99; the unrounded
    // difference (4.999) would round to 5.00 of fine at fineness 1.
    const split = splitAlloy(10.004, 1, 5.005);

    expect(split.alloy).toBe(0);
    expect(cg(split.fine) + cg(split.alloy) + cg(split.recycled)).toBe(
      cg(split.metal),
    );
  });

  it("makes fine + alloy + recycled equal the rounded metal EXACTLY, for any input", () => {
    const random = mulberry32(2026);

    for (let index = 0; index < 5000; index += 1) {
      const wax = 0.01 + random() * 400;
      const density = 8 + random() * 12;
      const allowance = random() * 0.3;
      const fineness = 0.3 + random() * 0.7;
      const metal = metalFromWax(wax, density, allowance);
      // Anywhere from none to all of the metal is recycled.
      const recycled = random() < 0.4 ? 0 : random() * metal;

      const split = splitAlloy(metal, fineness, recycled);

      // Exact in integer centigrams: no tolerance, no toBeCloseTo.
      expect(cg(split.fine) + cg(split.alloy) + cg(split.recycled)).toBe(
        cg(split.metal),
      );
      expect(split.fine).toBeGreaterThanOrEqual(0);
      expect(split.alloy).toBeGreaterThanOrEqual(0);
      // Every figure is a whole number of centigrams.
      for (const value of Object.values(split)) {
        expect(Math.abs(value * 100 - Math.round(value * 100))).toBeLessThan(
          1e-9,
        );
      }
    }
  });

  it.each([
    ["zero metal", () => splitAlloy(0, 0.925), "metalGrams", "not-positive"],
    ["negative metal", () => splitAlloy(-5, 0.925), "metalGrams", "not-positive"],
    ["NaN metal", () => splitAlloy(Number.NaN, 0.925), "metalGrams", "not-a-number"],
    ["zero fineness", () => splitAlloy(10, 0), "fineness", "out-of-range"],
    ["negative fineness", () => splitAlloy(10, -0.5), "fineness", "out-of-range"],
    ["fineness over 1", () => splitAlloy(10, 1.001), "fineness", "out-of-range"],
    ["NaN fineness", () => splitAlloy(10, Number.NaN), "fineness", "not-a-number"],
    ["negative recycled", () => splitAlloy(10, 0.9, -1), "recycledGrams", "out-of-range"],
    ["NaN recycled", () => splitAlloy(10, 0.9, Number.NaN), "recycledGrams", "not-a-number"],
    ["recycled over the metal", () => splitAlloy(10, 0.9, 10.5), "recycledGrams", "recycled-exceeds-metal"],
  ])("rejects %s", (_label, run, field, code) => {
    expect(run).toThrow(CastingInputError);
    try {
      run();
    } catch (error) {
      expect(error).toMatchObject({ field, code });
    }
  });

  it("accepts a fineness of exactly 1 and recycled equal to the metal", () => {
    expect(splitAlloy(10, 1)).toEqual({ metal: 10, fine: 10, alloy: 0, recycled: 0 });
    expect(() => splitAlloy(10, 0.5, 10)).not.toThrow();
  });
});

describe("CastingInputError", () => {
  it("is a real Error carrying the field and the code", () => {
    const error = new CastingInputError("waxGrams", "not-positive", "boom");

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("CastingInputError");
    expect(error.field).toBe("waxGrams");
    expect(error.code).toBe("not-positive");
    expect(error.message).toBe("boom");
  });
});

describe("safeCalculateCasting", () => {
  it("returns the result as a value when the input is valid", () => {
    expect(
      safeCalculateCasting({ waxGrams: 5, density: 13.07, fineness: 0.585 }),
    ).toEqual({
      ok: true,
      value: { metal: 71.89, fine: 42.05, alloy: 29.84, recycled: 0 },
    });
  });

  it("returns the problem as a value instead of throwing while someone types", () => {
    const outcome = safeCalculateCasting({
      waxGrams: Number.NaN,
      density: 13.07,
      fineness: 0.585,
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toBeInstanceOf(CastingInputError);
      expect(outcome.error.field).toBe("waxGrams");
    }
  });

  it("surfaces a recycled amount above the metal as a typed problem", () => {
    const outcome = safeCalculateCasting({
      waxGrams: 1,
      density: 10,
      fineness: 0.9,
      recycledGrams: 99,
    });

    expect(outcome).toMatchObject({
      ok: false,
      error: { field: "recycledGrams", code: "recycled-exceeds-metal" },
    });
  });
});
