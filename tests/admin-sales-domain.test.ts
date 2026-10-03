import { describe, expect, it } from "vitest";
import {
  MAX_SALE_ITEMS,
  SALE_SOURCES,
  SALE_STATUSES,
  SalesError,
  costSnapshot,
  itemsSubtotal,
  summarizeSales,
  type SaleFigures,
} from "@/lib/admin/domain/sales";

function sale(overrides: Partial<SaleFigures> = {}): SaleFigures {
  return {
    status: "active",
    subtotal: 100_000,
    shipping: 0,
    total: 100_000,
    costOfGoods: 40_000,
    costPending: false,
    ...overrides,
  };
}

describe("itemsSubtotal", () => {
  it("adds what each piece sold for", () => {
    expect(itemsSubtotal([{ price: 185_000 }, { price: 99_950 }])).toBe(284_950);
  });

  it("is zero for no items", () => {
    expect(itemsSubtotal([])).toBe(0);
  });
});

describe("costSnapshot", () => {
  it("adds the cost of every piece, none pending when all have one", () => {
    const totals = new Map([
      ["anillo", 50_000],
      ["aretes", 25_000],
    ]);

    expect(costSnapshot(["anillo", "aretes"], totals)).toEqual({
      costOfGoods: 75_000,
      costPending: false,
    });
  });

  it("marks the sale pending when any piece has no cost, counting what is known", () => {
    const totals = new Map([["anillo", 50_000]]);

    expect(costSnapshot(["anillo", "aretes"], totals)).toEqual({
      costOfGoods: 50_000,
      costPending: true,
    });
  });

  it("tells a recorded cost of ZERO apart from no cost at all", () => {
    expect(costSnapshot(["regalo"], new Map([["regalo", 0]]))).toEqual({
      costOfGoods: 0,
      costPending: false,
    });
    expect(costSnapshot(["regalo"], new Map())).toEqual({
      costOfGoods: 0,
      costPending: true,
    });
  });

  it("is a settled zero for a sale with no pieces", () => {
    expect(costSnapshot([], new Map())).toEqual({ costOfGoods: 0, costPending: false });
  });
});

describe("summarizeSales (period totals)", () => {
  it("totals sales, cost of goods and gross profit", () => {
    const totals = summarizeSales([
      sale({ subtotal: 185_000, total: 185_000, costOfGoods: 60_000 }),
      sale({ subtotal: 90_000, shipping: 15_000, total: 105_000, costOfGoods: 30_000 }),
    ]);

    expect(totals).toEqual({
      count: 2,
      voidedCount: 0,
      subtotal: 275_000,
      shipping: 15_000,
      total: 290_000,
      costOfGoods: 90_000,
      grossProfit: 185_000,
      pendingCount: 0,
    });
  });

  it("leaves a voided sale out of EVERY figure and only counts it as voided", () => {
    const totals = summarizeSales([
      sale({ subtotal: 100_000, total: 100_000, costOfGoods: 40_000 }),
      sale({
        status: "void",
        subtotal: 999_999,
        shipping: 50_000,
        total: 1_049_999,
        costOfGoods: 500_000,
        costPending: true,
      }),
    ]);

    expect(totals).toEqual({
      count: 1,
      voidedCount: 1,
      subtotal: 100_000,
      shipping: 0,
      total: 100_000,
      costOfGoods: 40_000,
      grossProfit: 60_000,
      pendingCount: 0,
    });
  });

  it("keeps shipping out of the sales figure and the gross profit", () => {
    const totals = summarizeSales([
      sale({ subtotal: 100_000, shipping: 20_000, total: 120_000, costOfGoods: 40_000 }),
    ]);

    expect(totals.subtotal).toBe(100_000);
    expect(totals.shipping).toBe(20_000);
    expect(totals.total).toBe(120_000);
    expect(totals.grossProfit).toBe(60_000);
  });

  it("counts the sales whose cost was still pending, so the profit can be flagged", () => {
    const totals = summarizeSales([
      sale({ costPending: true, costOfGoods: 0 }),
      sale({ costPending: true }),
      sale(),
    ]);

    expect(totals.pendingCount).toBe(2);
    expect(totals.count).toBe(3);
  });

  it("can show a loss", () => {
    expect(
      summarizeSales([sale({ subtotal: 10_000, total: 10_000, costOfGoods: 30_000 })])
        .grossProfit,
    ).toBe(-20_000);
  });

  it("is all zeros for an empty period", () => {
    expect(summarizeSales([])).toEqual({
      count: 0,
      voidedCount: 0,
      subtotal: 0,
      shipping: 0,
      total: 0,
      costOfGoods: 0,
      grossProfit: 0,
      pendingCount: 0,
    });
  });

  it("accepts any iterable, not just an array", () => {
    const totals = summarizeSales(new Set([sale(), sale({ subtotal: 5 })]));

    expect(totals.count).toBe(2);
  });
});

describe("sales vocabulary", () => {
  it("knows exactly two sources and two statuses", () => {
    expect([...SALE_SOURCES]).toEqual(["stripe", "manual"]);
    expect([...SALE_STATUSES]).toEqual(["active", "void"]);
  });

  it("bounds a manual sale to a transaction-sized number of pieces", () => {
    expect(MAX_SALE_ITEMS).toBe(25);
  });

  it("carries its code as the contract", () => {
    const error = new SalesError("piece-unavailable");

    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("piece-unavailable");
    expect(error.name).toBe("SalesError");
  });
});
