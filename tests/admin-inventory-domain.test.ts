import { describe, expect, it } from "vitest";
import {
  InventoryError,
  applyAdjustment,
  consumeStock,
  fineKindFor,
  moveStock,
  movementValue,
  planCorrection,
  receiveStock,
  type StockState,
} from "@/lib/admin/domain/inventory";

const EMPTY: StockState = { stock: 0, avgCost: 0 };

function codeOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return error instanceof InventoryError ? error.code : "not-an-inventory-error";
  }
  return undefined;
}

describe("receiveStock", () => {
  it("prices a first purchase at cost / qty", () => {
    expect(receiveStock(EMPTY, "g", 10, 15_000)).toEqual({
      stock: 10,
      avgCost: 1500,
    });
  });

  it("re-averages and adds the stock on a second purchase", () => {
    const first = receiveStock(EMPTY, "g", 10, 10_000); // $10.00 / g
    const second = receiveStock(first, "g", 5, 9000); // $18.00 / g

    expect(second).toEqual({ stock: 15, avgCost: 1267 });
  });

  it("adds fractional grams without floating-point drift", () => {
    const state = receiveStock(
      receiveStock(EMPTY, "g", 0.1, 10),
      "g",
      0.2,
      20,
    );

    expect(state.stock).toBe(0.3);
  });

  it("works in whole pieces", () => {
    expect(receiveStock(EMPTY, "pz", 3, 4500)).toEqual({ stock: 3, avgCost: 1500 });
  });

  it.each([
    ["zero", 0],
    ["negative", -1],
    ["NaN", Number.NaN],
    ["Infinity", Infinity],
    ["three decimals of a gram", 1.005],
  ])("rejects a %s quantity", (_label, qty) => {
    expect(codeOf(() => receiveStock(EMPTY, "g", qty, 100))).toBe("invalid-quantity");
  });

  it("rejects a fractional number of pieces", () => {
    expect(codeOf(() => receiveStock(EMPTY, "pz", 1.5, 100))).toBe("invalid-quantity");
  });

  it.each([
    ["fractional", 10.5],
    ["negative", -1],
    ["NaN", Number.NaN],
  ])("rejects a %s cost", (_label, cost) => {
    expect(codeOf(() => receiveStock(EMPTY, "g", 1, cost))).toBe("invalid-cost");
  });
});

describe("moveStock", () => {
  const onHand: StockState = { stock: 100, avgCost: 1500 };

  it("applies a signed delta and NEVER changes the average cost", () => {
    expect(moveStock(onHand, "g", -40.25)).toEqual({ stock: 59.75, avgCost: 1500 });
    expect(moveStock(onHand, "g", 10)).toEqual({ stock: 110, avgCost: 1500 });
  });

  it("can take stock to exactly zero", () => {
    const state = moveStock({ stock: 62.35, avgCost: 800 }, "g", -62.35);

    expect(state.stock).toBe(0);
    // The old average is kept: the next purchase re-prices from scratch.
    expect(state.avgCost).toBe(800);
  });

  it("refuses to go below zero, even by a hundredth", () => {
    expect(codeOf(() => moveStock(onHand, "g", -100.01))).toBe("insufficient-stock");
    expect(codeOf(() => moveStock({ stock: 0, avgCost: 0 }, "g", -0.01))).toBe(
      "insufficient-stock",
    );
  });

  it("rejects a delta of zero or one that does not fit the unit", () => {
    expect(codeOf(() => moveStock(onHand, "g", 0))).toBe("invalid-quantity");
    expect(codeOf(() => moveStock(onHand, "g", 0.005))).toBe("invalid-quantity");
    expect(codeOf(() => moveStock(onHand, "pz", 0.5))).toBe("invalid-quantity");
    expect(codeOf(() => moveStock(onHand, "g", Number.NaN))).toBe("invalid-quantity");
  });
});

describe("consumeStock", () => {
  it("removes a positive quantity", () => {
    expect(consumeStock({ stock: 70, avgCost: 1500 }, "g", 62.35)).toEqual({
      stock: 7.65,
      avgCost: 1500,
    });
  });

  it("rejects a non-positive quantity instead of adding stock", () => {
    expect(codeOf(() => consumeStock({ stock: 10, avgCost: 1 }, "g", 0))).toBe(
      "invalid-quantity",
    );
    expect(codeOf(() => consumeStock({ stock: 10, avgCost: 1 }, "g", -5))).toBe(
      "invalid-quantity",
    );
  });

  it("reports insufficient stock with a typed error", () => {
    expect(codeOf(() => consumeStock({ stock: 10, avgCost: 1 }, "g", 10.01))).toBe(
      "insufficient-stock",
    );
  });
});

describe("movementValue", () => {
  it("is |qty| x unit cost in whole centavos, always a magnitude", () => {
    expect(movementValue(1500, -2.5)).toBe(3750);
    expect(movementValue(1500, 2.5)).toBe(3750);
  });

  it("rounds half up", () => {
    expect(movementValue(333, 0.5)).toBe(167); // 166.5
  });
});

describe("fineKindFor", () => {
  it("draws fine silver for silver and fine gold for every gold alloy", () => {
    expect(fineKindFor("silver-925")).toBe("fine_silver");
    expect(fineKindFor("gold-10k")).toBe("fine_gold");
    expect(fineKindFor("gold-14k")).toBe("fine_gold");
    expect(fineKindFor("gold-18k")).toBe("fine_gold");
  });
});

describe("InventoryError", () => {
  it("is a real Error whose code is the contract", () => {
    const error = new InventoryError("insufficient-stock");

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("InventoryError");
    expect(error.code).toBe("insufficient-stock");
  });
});

describe("applyAdjustment", () => {
  const onHand: StockState = { stock: 30, avgCost: 3333 };

  it("refuses to add stock without a unit cost: units never enter the ledger for free", () => {
    expect(codeOf(() => applyAdjustment(onHand, "g", "adjustment", 30))).toBe("invalid-cost");
    expect(codeOf(() => applyAdjustment(EMPTY, "g", "adjustment", 30))).toBe("invalid-cost");
  });

  it("refuses an invalid unit cost", () => {
    for (const unitCost of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(codeOf(() => applyAdjustment(onHand, "g", "adjustment", 5, unitCost))).toBe(
        "invalid-cost",
      );
    }
  });

  it("prices a positive count like a purchase of those units and re-weights the average", () => {
    // (30 x 3333 + 30 x 1000) / 60 = 2166.5 -> 2167
    expect(applyAdjustment(onHand, "g", "adjustment", 30, 1000)).toEqual({
      stock: 60,
      avgCost: 2167,
    });
    // Exactly what receiveStock does for the same units and the same total.
    expect(applyAdjustment(onHand, "g", "adjustment", 30, 1000)).toEqual(
      receiveStock(onHand, "g", 30, movementValue(1000, 30)),
    );
  });

  it("starts from the stated cost when nothing was on hand", () => {
    expect(applyAdjustment(EMPTY, "g", "adjustment", 30, 3333)).toEqual({
      stock: 30,
      avgCost: 3333,
    });
  });

  it("keeps the average when the units come in at the cost they already carry", () => {
    expect(applyAdjustment(onHand, "g", "adjustment", 10, 3333)).toEqual({
      stock: 40,
      avgCost: 3333,
    });
  });

  it("accepts a cost of 0 when it is stated", () => {
    // (30 x 3333) / 40 = 2499.75 -> 2500
    expect(applyAdjustment(onHand, "g", "adjustment", 10, 0)).toEqual({
      stock: 40,
      avgCost: 2500,
    });
  });

  it("removes stock without ever touching the average, and needs no cost", () => {
    expect(applyAdjustment(onHand, "g", "adjustment", -5)).toEqual({ stock: 25, avgCost: 3333 });
    expect(applyAdjustment(onHand, "g", "loss", -5.5)).toEqual({ stock: 24.5, avgCost: 3333 });
    // A cost sent with a removal is not used.
    expect(applyAdjustment(onHand, "g", "adjustment", -5, 99_999)).toEqual({
      stock: 25,
      avgCost: 3333,
    });
  });

  it("refuses a loss that is not negative", () => {
    expect(codeOf(() => applyAdjustment(onHand, "g", "loss", 5, 100))).toBe("invalid-quantity");
    expect(codeOf(() => applyAdjustment(onHand, "g", "loss", 0))).toBe("invalid-quantity");
  });

  it("still refuses to go below zero, a zero quantity and the wrong precision", () => {
    expect(codeOf(() => applyAdjustment(onHand, "g", "adjustment", -30.01))).toBe(
      "insufficient-stock",
    );
    expect(codeOf(() => applyAdjustment(onHand, "g", "adjustment", 0, 100))).toBe(
      "invalid-quantity",
    );
    expect(codeOf(() => applyAdjustment(onHand, "pz", "adjustment", 1.5, 100))).toBe(
      "invalid-quantity",
    );
    expect(codeOf(() => applyAdjustment(onHand, "g", "adjustment", Number.NaN, 100))).toBe(
      "invalid-quantity",
    );
  });
});

describe("planCorrection", () => {
  // The state the Plata bug left behind.
  const buggy: StockState = { stock: 60, avgCost: 1667 };

  it("brings 60 g at 1667 to 30 g at 3333, with the signed change", () => {
    expect(planCorrection(buggy, "g", { stock: 30, avgCost: 3333 })).toEqual({
      stock: 30,
      avgCost: 3333,
      delta: -30,
    });
  });

  it("can raise the stock, or change only the cost", () => {
    expect(planCorrection(buggy, "g", { stock: 75.5, avgCost: 1667 })).toMatchObject({
      stock: 75.5,
      delta: 15.5,
    });
    expect(planCorrection(buggy, "g", { stock: 60, avgCost: 4000 })).toEqual({
      stock: 60,
      avgCost: 4000,
      delta: 0,
    });
  });

  it("allows zero stock", () => {
    expect(planCorrection(buggy, "g", { stock: 0, avgCost: 1667 })).toMatchObject({
      stock: 0,
      delta: -60,
    });
  });

  it("is exact on hundredths", () => {
    expect(planCorrection({ stock: 0.3, avgCost: 100 }, "g", { stock: 0.1, avgCost: 100 })).toMatchObject({
      delta: -0.2,
    });
  });

  it("refuses a correction that changes nothing", () => {
    expect(codeOf(() => planCorrection(buggy, "g", { stock: 60, avgCost: 1667 }))).toBe(
      "no-change",
    );
  });

  it("refuses a negative or wrongly-precise stock and an invalid cost", () => {
    expect(codeOf(() => planCorrection(buggy, "g", { stock: -1, avgCost: 1667 }))).toBe(
      "invalid-quantity",
    );
    expect(codeOf(() => planCorrection(buggy, "g", { stock: 1.005, avgCost: 1667 }))).toBe(
      "invalid-quantity",
    );
    expect(codeOf(() => planCorrection(buggy, "pz", { stock: 2.5, avgCost: 1667 }))).toBe(
      "invalid-quantity",
    );
    expect(codeOf(() => planCorrection(buggy, "g", { stock: Number.NaN, avgCost: 1667 }))).toBe(
      "invalid-quantity",
    );
    expect(codeOf(() => planCorrection(buggy, "g", { stock: 30, avgCost: -1 }))).toBe(
      "invalid-cost",
    );
    expect(codeOf(() => planCorrection(buggy, "g", { stock: 30, avgCost: 33.5 }))).toBe(
      "invalid-cost",
    );
  });
});
