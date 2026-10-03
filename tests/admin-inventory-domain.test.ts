import { describe, expect, it } from "vitest";
import {
  InventoryError,
  consumeStock,
  fineKindFor,
  moveStock,
  movementValue,
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
