import { describe, expect, it } from "vitest";
import { movementValue } from "@/lib/admin/domain/inventory";
import {
  formatPercent,
  metalCostFromGrams,
  pieceCostTotal,
  pieceMargin,
} from "@/lib/admin/domain/pieces";

describe("pieceCostTotal", () => {
  it("adds metal, stones, other and labor", () => {
    expect(
      pieceCostTotal({ metal: 120_000, stones: 30_000, other: 5_000, labor: 45_000 }),
    ).toBe(200_000);
  });

  it("treats a missing labor as zero (it is optional)", () => {
    expect(pieceCostTotal({ metal: 120_000, stones: 0, other: 0 })).toBe(120_000);
  });

  it("is zero for a piece recorded as free to make", () => {
    expect(pieceCostTotal({ metal: 0, stones: 0, other: 0, labor: 0 })).toBe(0);
  });
});

describe("pieceMargin", () => {
  it("is price minus cost, and a percentage OF THE PRICE", () => {
    // $4,000.00 price, $1,000.00 cost -> $3,000.00 = 75 %
    expect(pieceMargin(400_000, 100_000)).toEqual({
      margin: 300_000,
      marginPercent: 75,
    });
  });

  it("rounds the percentage to one decimal", () => {
    // 100 / 300 = 33.333...
    expect(pieceMargin(300, 200)).toEqual({ margin: 100, marginPercent: 33.3 });
  });

  it("rounds an exact tie half up, not to even", () => {
    // 49 / 400 = 12.25 exactly
    expect(pieceMargin(400, 351).marginPercent).toBe(12.3);
  });

  it("is negative when the piece sells below its cost", () => {
    expect(pieceMargin(100_000, 130_000)).toEqual({
      margin: -30_000,
      marginPercent: -30,
    });
  });

  it("is the whole price when the cost is zero", () => {
    expect(pieceMargin(250_000, 0)).toEqual({ margin: 250_000, marginPercent: 100 });
  });

  it("has no percentage for a piece with no price, instead of dividing by zero", () => {
    expect(pieceMargin(0, 5_000)).toEqual({ margin: -5_000, marginPercent: null });
  });
});

describe("metalCostFromGrams (Calcular metal)", () => {
  it("is grams times the average cost per gram", () => {
    // 12.5 g at $18.00 / g = $225.00
    expect(metalCostFromGrams(12.5, 1800)).toBe(22_500);
  });

  it("rounds to a whole centavo, half up", () => {
    // 3.333 g x 1267 c = 4222.911 c
    expect(metalCostFromGrams(3.333, 1267)).toBe(4223);
    // 0.5 g x 1 c = 0.5 c, a tie
    expect(metalCostFromGrams(0.5, 1)).toBe(1);
  });

  it("prices metal exactly like the ledger values a movement of it", () => {
    for (const [grams, avgCost] of [
      [71.89, 1500],
      [42.05, 150_000],
      [0.01, 999],
    ] as const) {
      expect(metalCostFromGrams(grams, avgCost)).toBe(movementValue(avgCost, grams));
    }
  });

  it("is zero when the material has no cost yet", () => {
    expect(metalCostFromGrams(10, 0)).toBe(0);
  });

  it.each([0, -1, Number.NaN, Infinity])("rejects %s grams", (grams) => {
    expect(() => metalCostFromGrams(grams, 1800)).toThrow(RangeError);
  });

  it.each([-1, 1.5, Number.NaN])("rejects an average cost of %s", (avgCost) => {
    expect(() => metalCostFromGrams(10, avgCost)).toThrow(RangeError);
  });
});

describe("formatPercent", () => {
  it.each([
    [75, "75.0 %"],
    [42.5, "42.5 %"],
    [33.3, "33.3 %"],
    [0, "0.0 %"],
    [-30, "-30.0 %"],
  ])("writes %s as %s", (value, text) => {
    expect(formatPercent(value)).toBe(text);
  });
});
