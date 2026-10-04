import { describe, expect, it } from "vitest";
import {
  MAX_SALE_ITEMS,
  SALE_SOURCES,
  SALE_STATUSES,
  SalesError,
  costSnapshot,
  isVoidableSale,
  itemsSubtotal,
  resolveLivemode,
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
    livemode: true,
    fee: 0,
    feePending: false,
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
      testCount: 0,
      subtotal: 275_000,
      shipping: 15_000,
      total: 290_000,
      costOfGoods: 90_000,
      grossProfit: 185_000,
      pendingCount: 0,
      fees: 0,
      pendingFeeCount: 0,
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
      testCount: 0,
      subtotal: 100_000,
      shipping: 0,
      total: 100_000,
      costOfGoods: 40_000,
      grossProfit: 60_000,
      pendingCount: 0,
      fees: 0,
      pendingFeeCount: 0,
    });
  });

  it("leaves a test-mode sale out of EVERY figure and only counts it as a test", () => {
    const totals = summarizeSales([
      sale({ subtotal: 100_000, total: 100_000, costOfGoods: 40_000, fee: 3_000 }),
      sale({
        livemode: false,
        subtotal: 999_999,
        shipping: 50_000,
        total: 1_049_999,
        costOfGoods: 500_000,
        costPending: true,
        fee: 77_000,
        feePending: true,
      }),
    ]);

    expect(totals).toEqual({
      count: 1,
      voidedCount: 0,
      testCount: 1,
      subtotal: 100_000,
      shipping: 0,
      total: 100_000,
      costOfGoods: 40_000,
      grossProfit: 60_000,
      // Neither the test sale's pending cost nor its pending fee is counted.
      pendingCount: 0,
      fees: 3_000,
      pendingFeeCount: 0,
    });
  });

  it("counts a voided test sale as voided, once, never as a test as well", () => {
    const totals = summarizeSales([sale({ livemode: false, status: "void" })]);

    expect(totals.voidedCount).toBe(1);
    expect(totals.testCount).toBe(0);
    expect(totals.count).toBe(0);
  });

  it("adds up the commissions of the counted sales, apart from the sales figure", () => {
    const totals = summarizeSales([
      sale({ subtotal: 185_000, total: 200_000, shipping: 15_000, fee: 7_540 }),
      // A manual sale's commission is the terminal's.
      sale({ subtotal: 90_000, total: 90_000, fee: 2_900 }),
      sale({ fee: 0 }),
    ]);

    expect(totals.fees).toBe(10_440);
    expect(totals.subtotal).toBe(375_000);
    expect(totals.grossProfit).toBe(375_000 - 120_000);
  });

  it("counts the Stripe sales whose fee is still pending, adding nothing for them", () => {
    const totals = summarizeSales([
      sale({ fee: 0, feePending: true }),
      sale({ fee: 0, feePending: true }),
      sale({ fee: 4_000 }),
    ]);

    expect(totals.pendingFeeCount).toBe(2);
    expect(totals.fees).toBe(4_000);
    expect(totals.count).toBe(3);
  });

  it("does not count the commission of a voided sale", () => {
    const totals = summarizeSales([sale({ status: "void", fee: 9_000, feePending: true })]);

    expect(totals.fees).toBe(0);
    expect(totals.pendingFeeCount).toBe(0);
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
      testCount: 0,
      subtotal: 0,
      shipping: 0,
      total: 0,
      costOfGoods: 0,
      grossProfit: 0,
      pendingCount: 0,
      fees: 0,
      pendingFeeCount: 0,
    });
  });

  it("accepts any iterable, not just an array", () => {
    const totals = summarizeSales(new Set([sale(), sale({ subtotal: 5 })]));

    expect(totals.count).toBe(2);
  });
});

describe("resolveLivemode", () => {
  it("trusts a stored boolean, whatever the session id says", () => {
    expect(resolveLivemode(false, "cs_live_abc")).toBe(false);
    expect(resolveLivemode(true, "cs_test_abc")).toBe(true);
    expect(resolveLivemode(false, undefined)).toBe(false);
  });

  it("judges a document without the field by its Checkout Session id", () => {
    expect(resolveLivemode(undefined, "cs_test_a1B2c3")).toBe(false);
    expect(resolveLivemode(undefined, "cs_live_a1B2c3")).toBe(true);
  });

  it.each([
    ["no session id (a manual sale)", undefined, undefined],
    ["an unreadable session id", undefined, "x"],
    ["a session id of no known mode", undefined, "cs_other_1"],
    ["a non-string session id", undefined, 42],
    ["a stored value that is not a boolean, and no session id", "false", undefined],
  ])("counts as live with %s: a real sale until proven otherwise", (_label, stored, id) => {
    expect(resolveLivemode(stored, id)).toBe(true);
  });

  it("ignores a stored value that is not a boolean, and lets the session id decide", () => {
    expect(resolveLivemode(0, "cs_test_1")).toBe(false);
    expect(resolveLivemode("true", "cs_test_1")).toBe(false);
  });
});

describe("isVoidableSale", () => {
  it("allows a manual sale", () => {
    expect(isVoidableSale("manual", true)).toBe(true);
  });

  it("allows a Stripe sale made in test mode: there is no real payment to refund", () => {
    expect(isVoidableSale("stripe", false)).toBe(true);
  });

  it("refuses a LIVE Stripe sale: it is refunded in Stripe, not voided here", () => {
    expect(isVoidableSale("stripe", true)).toBe(false);
  });

  it.each(["carrier-pigeon", "", undefined, null, 1])(
    "refuses a sale whose source is unreadable (%j), test or not",
    (source) => {
      expect(isVoidableSale(source, true)).toBe(false);
      expect(isVoidableSale(source, false)).toBe(false);
    },
  );
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
