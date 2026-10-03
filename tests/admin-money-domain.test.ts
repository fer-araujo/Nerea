import { describe, expect, it } from "vitest";
import {
  centavosToPesosText,
  formatMXN,
  inventoryValue,
  isCentavos,
  pesosToCentavos,
  unitCostFromTotal,
  weightedAverageCost,
} from "@/lib/admin/domain/money";
import {
  formatDecimal,
  formatGrams,
  formatQuantity,
  fromHundredths,
  hasValidPrecision,
  toHundredths,
} from "@/lib/admin/domain/quantity";
import { roundTo } from "@/lib/admin/domain/round";

describe("roundTo", () => {
  it.each([
    [1.005, 2, 1.01],
    [2.675, 2, 2.68],
    [0.285, 2, 0.29],
    [62.345, 2, 62.35],
    [71.885, 2, 71.89],
    [1.004, 2, 1],
    [0.5, 0, 1],
    [1.5, 0, 2],
    [2.5, 0, 3],
    [1266.6666, 0, 1267],
  ])("rounds %s at %s decimals to %s", (value, decimals, expected) => {
    expect(roundTo(value, decimals)).toBe(expected);
  });

  it("rounds half away from zero, symmetrically", () => {
    expect(roundTo(-1.005, 2)).toBe(-1.01);
    expect(roundTo(-2.5)).toBe(-3);
  });

  it("never returns negative zero", () => {
    expect(Object.is(roundTo(-0.001, 2), 0)).toBe(true);
  });

  it("returns non-finite input untouched instead of disguising it as 0", () => {
    expect(roundTo(Number.NaN)).toBeNaN();
    expect(roundTo(Infinity)).toBe(Infinity);
  });
});

describe("weightedAverageCost", () => {
  it("is ((stock x avg) + cost) / (stock + qty), rounded to a whole centavo", () => {
    // 10 g @ $10.00 plus 5 g for $90.00 = $190.00 over 15 g = 1266.67 -> 1267.
    expect(
      weightedAverageCost({ stock: 10, avgCost: 1000, qty: 5, totalCost: 9000 }),
    ).toBe(1267);
  });

  it("rounds an exact half up", () => {
    expect(
      weightedAverageCost({ stock: 1, avgCost: 1, qty: 1, totalCost: 2 }),
    ).toBe(2); // 1.5
    expect(
      weightedAverageCost({ stock: 1, avgCost: 2, qty: 1, totalCost: 3 }),
    ).toBe(3); // 2.5
  });

  it("works with fractional stock and quantity", () => {
    // (12.35 x 1500 + 12000) / 20 = 1526.25
    expect(
      weightedAverageCost({ stock: 12.35, avgCost: 1500, qty: 7.65, totalCost: 12000 }),
    ).toBe(1526);
  });

  it("keeps the average when the new units cost exactly the same", () => {
    expect(
      weightedAverageCost({ stock: 8, avgCost: 1500, qty: 2, totalCost: 3000 }),
    ).toBe(1500);
  });

  it("uses cost / qty when nothing is on hand, ignoring the stale average", () => {
    expect(
      weightedAverageCost({ stock: 0, avgCost: 999_999, qty: 4, totalCost: 10_001 }),
    ).toBe(2500); // 2500.25
  });

  it("treats negative stock like none", () => {
    expect(
      weightedAverageCost({ stock: -5, avgCost: 1000, qty: 2, totalCost: 3000 }),
    ).toBe(1500);
  });

  it("can average a free (zero-cost) purchase in", () => {
    expect(
      weightedAverageCost({ stock: 10, avgCost: 1000, qty: 10, totalCost: 0 }),
    ).toBe(500);
  });

  it.each([
    ["zero qty", { stock: 1, avgCost: 1, qty: 0, totalCost: 1 }],
    ["negative qty", { stock: 1, avgCost: 1, qty: -1, totalCost: 1 }],
    ["NaN qty", { stock: 1, avgCost: 1, qty: Number.NaN, totalCost: 1 }],
    ["fractional cost", { stock: 1, avgCost: 1, qty: 1, totalCost: 1.5 }],
    ["negative cost", { stock: 1, avgCost: 1, qty: 1, totalCost: -1 }],
    ["fractional average", { stock: 1, avgCost: 0.5, qty: 1, totalCost: 1 }],
    ["NaN stock", { stock: Number.NaN, avgCost: 1, qty: 1, totalCost: 1 }],
  ])("rejects %s", (_label, input) => {
    expect(() => weightedAverageCost(input)).toThrow(RangeError);
  });
});

describe("unitCostFromTotal", () => {
  it("is total / qty in whole centavos, rounded half up", () => {
    expect(unitCostFromTotal(10_001, 4)).toBe(2500);
    expect(unitCostFromTotal(2, 3)).toBe(1);
    expect(unitCostFromTotal(3, 2)).toBe(2);
  });

  it("rejects a non-positive quantity and a fractional total", () => {
    expect(() => unitCostFromTotal(100, 0)).toThrow(RangeError);
    expect(() => unitCostFromTotal(100.5, 1)).toThrow(RangeError);
  });
});

describe("money helpers", () => {
  it("converts pesos to integer centavos without float noise", () => {
    expect(pesosToCentavos(1234.56)).toBe(123456);
    expect(pesosToCentavos(19.99)).toBe(1999);
    expect(pesosToCentavos(0.1 + 0.2)).toBe(30);
    expect(pesosToCentavos(0)).toBe(0);
  });

  it("recognises integer centavos", () => {
    expect(isCentavos(0)).toBe(true);
    expect(isCentavos(150)).toBe(true);
    expect(isCentavos(1.5)).toBe(false);
    expect(isCentavos(-1)).toBe(false);
    expect(isCentavos(Number.NaN)).toBe(false);
    expect(isCentavos(Number.MAX_SAFE_INTEGER + 1)).toBe(false);
  });

  it("values what is on hand in whole centavos", () => {
    expect(inventoryValue(12.35, 1500)).toBe(18_525);
    expect(inventoryValue(0, 1500)).toBe(0);
    expect(inventoryValue(-3, 1500)).toBe(0);
  });

  it("formats centavos as Mexican pesos", () => {
    expect(formatMXN(123_456)).toBe("$1,234.56");
    expect(formatMXN(0)).toBe("$0.00");
    expect(formatMXN(5)).toBe("$0.05");
    expect(formatMXN(-5000)).toBe("-$50.00");
  });
});

describe("quantity helpers", () => {
  it("counts in exact integer hundredths", () => {
    expect(toHundredths(62.35)).toBe(6235);
    expect(toHundredths(0.1 + 0.2)).toBe(30);
    expect(fromHundredths(6235)).toBe(62.35);
    // The classic drift, gone: 0.1 + 0.2 in hundredths is exactly 0.3.
    expect(fromHundredths(toHundredths(0.1) + toHundredths(0.2))).toBe(0.3);
  });

  it("checks precision against the unit", () => {
    expect(hasValidPrecision("g", 1.25)).toBe(true);
    expect(hasValidPrecision("g", 1)).toBe(true);
    expect(hasValidPrecision("g", 1.255)).toBe(false);
    expect(hasValidPrecision("pz", 3)).toBe(true);
    expect(hasValidPrecision("pz", 2.5)).toBe(false);
    expect(hasValidPrecision("g", Number.NaN)).toBe(false);
    expect(hasValidPrecision("pz", Infinity)).toBe(false);
  });

  it("formats grams, pieces and formula steps", () => {
    expect(formatGrams(71.89)).toBe("71.89 g");
    expect(formatGrams(1234.5)).toBe("1,234.50 g");
    expect(formatGrams(0)).toBe("0.00 g");
    expect(formatQuantity(3, "pz")).toBe("3 pz");
    expect(formatQuantity(62.35, "g")).toBe("62.35 g");
    expect(formatDecimal(71.885)).toBe("71.885");
    expect(formatDecimal(5)).toBe("5");
    expect(formatDecimal(0.585)).toBe("0.585");
    // The default stops at three decimals; a finer fineness asks for more.
    expect(formatDecimal(0.41666)).toBe("0.417");
    expect(formatDecimal(0.41666, 5)).toBe("0.41666");
  });
});

describe("centavosToPesosText", () => {
  it.each([
    [0, "0.00"],
    [5, "0.05"],
    [100, "1.00"],
    [123_456, "1234.56"],
    [185_000, "1850.00"],
    [9_999_999_999, "99999999.99"],
  ])("writes %i centavos as %s pesos", (centavos, text) => {
    expect(centavosToPesosText(centavos)).toBe(text);
  });

  it("round-trips through pesosToCentavos", () => {
    for (const centavos of [1, 99, 101, 123_457, 10_000_000]) {
      expect(pesosToCentavos(Number(centavosToPesosText(centavos)))).toBe(centavos);
    }
  });

  it.each([-1, 1.5, Number.NaN, Infinity])(
    "answers 0.00 for something that is not whole non-negative centavos (%s)",
    (value) => {
      expect(centavosToPesosText(value)).toBe("0.00");
    },
  );
});
