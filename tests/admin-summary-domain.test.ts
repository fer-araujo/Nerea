import { describe, expect, it } from "vitest";
import { periodRange } from "@/lib/admin/domain/periods";
import {
  SUMMARY_MONTHS,
  countPieces,
  inventoryTotal,
  ledgerWindow,
  marginPercent,
  monthlyBuckets,
  periodKpis,
  type SummaryPurchase,
  type SummarySale,
} from "@/lib/admin/domain/summary";

// 2026-10-03 12:00 in Mexico City (UTC-6, no daylight saving since 2022).
const NOW = new Date("2026-10-03T18:00:00Z");
const THIS_MONTH = periodRange("this-month", NOW);

function sale(overrides: Partial<SummarySale> = {}): SummarySale {
  return {
    date: new Date("2026-10-02T06:00:00Z"),
    status: "active",
    subtotal: 100_000,
    shipping: 0,
    total: 100_000,
    costOfGoods: 40_000,
    costPending: false,
    ...overrides,
  };
}

function purchase(overrides: Partial<SummaryPurchase> = {}): SummaryPurchase {
  return {
    date: new Date("2026-10-02T06:00:00Z"),
    totalCost: 30_000,
    ...overrides,
  };
}

describe("periodKpis", () => {
  it("adds up the subtotal of the active sales as ventas, with shipping kept apart", () => {
    const kpis = periodKpis(
      [
        sale({ subtotal: 100_000, shipping: 15_000, total: 115_000, costOfGoods: 40_000 }),
        sale({ subtotal: 50_000, shipping: 0, total: 50_000, costOfGoods: 10_000 }),
      ],
      [],
      THIS_MONTH,
    );

    expect(kpis.sales).toBe(150_000);
    expect(kpis.salesCount).toBe(2);
    expect(kpis.costOfGoods).toBe(50_000);
  });

  it("computes the gross profit, its margin, the investments and the cash flow", () => {
    const kpis = periodKpis(
      [sale({ subtotal: 150_000, costOfGoods: 50_000 })],
      [purchase({ totalCost: 30_000 }), purchase({ totalCost: 20_000 })],
      THIS_MONTH,
    );

    expect(kpis.grossProfit).toBe(100_000);
    // 100_000 of 150_000 is 66.666...%, one decimal.
    expect(kpis.marginPercent).toBe(66.7);
    expect(kpis.investments).toBe(50_000);
    expect(kpis.purchaseCount).toBe(2);
    // Flujo = ventas - inversiones.
    expect(kpis.cashFlow).toBe(100_000);
  });

  it("leaves a voided sale out of every figure and only counts it as voided", () => {
    const kpis = periodKpis(
      [
        sale({ subtotal: 100_000, costOfGoods: 40_000 }),
        sale({
          status: "void",
          subtotal: 900_000,
          shipping: 90_000,
          total: 990_000,
          costOfGoods: 500_000,
          costPending: true,
        }),
      ],
      [],
      THIS_MONTH,
    );

    expect(kpis.salesCount).toBe(1);
    expect(kpis.voidedCount).toBe(1);
    expect(kpis.sales).toBe(100_000);
    expect(kpis.costOfGoods).toBe(40_000);
    expect(kpis.grossProfit).toBe(60_000);
    // Nor does a voided sale make the cost "pending".
    expect(kpis.pendingCostCount).toBe(0);
  });

  it("goes negative when the cost is above the sales, and says so in the margin", () => {
    const kpis = periodKpis(
      [sale({ subtotal: 100_000, costOfGoods: 130_000 })],
      [],
      THIS_MONTH,
    );

    expect(kpis.grossProfit).toBe(-30_000);
    expect(kpis.marginPercent).toBe(-30);
  });

  it("has a negative cash flow when more went out than came in", () => {
    const kpis = periodKpis(
      [sale({ subtotal: 20_000, costOfGoods: 5_000 })],
      [purchase({ totalCost: 120_000 })],
      THIS_MONTH,
    );

    expect(kpis.cashFlow).toBe(-100_000);
    expect(kpis.grossProfit).toBe(15_000);
  });

  it("has no margin when nothing was sold", () => {
    const kpis = periodKpis([], [purchase({ totalCost: 12_345 })], THIS_MONTH);

    expect(kpis.sales).toBe(0);
    expect(kpis.grossProfit).toBe(0);
    expect(kpis.marginPercent).toBeNull();
    expect(kpis.cashFlow).toBe(-12_345);
  });

  it("counts the sales whose cost was pending, as a data-quality hint", () => {
    const kpis = periodKpis(
      [
        sale({ costPending: true }),
        sale({ costPending: true }),
        sale({ costPending: false }),
      ],
      [],
      THIS_MONTH,
    );

    expect(kpis.pendingCostCount).toBe(2);
  });

  it("keeps only the documents inside the half-open range", () => {
    const kpis = periodKpis(
      [
        sale({ date: THIS_MONTH.start, subtotal: 1_000 }), // first instant: in
        sale({ date: THIS_MONTH.end, subtotal: 2_000 }), // the next month's first instant: out
        sale({ date: null, subtotal: 4_000 }), // no readable date: in no period
      ],
      [
        purchase({ date: THIS_MONTH.start, totalCost: 10 }),
        purchase({ date: THIS_MONTH.end, totalCost: 20 }),
        purchase({ date: null, totalCost: 40 }),
      ],
      THIS_MONTH,
    );

    expect(kpis.sales).toBe(1_000);
    expect(kpis.investments).toBe(10);
  });

  it("draws the month boundary at midnight in Mexico City, not in UTC", () => {
    const kpis = periodKpis(
      [
        // 23:59:59.999 on September 30th in Mexico City: still September.
        sale({ date: new Date("2026-10-01T05:59:59.999Z"), subtotal: 1_000 }),
        // 00:00 on October 1st in Mexico City: October.
        sale({ date: new Date("2026-10-01T06:00:00.000Z"), subtotal: 2_000 }),
        // 23:59:59.999 on October 31st in Mexico City: still October.
        sale({ date: new Date("2026-11-01T05:59:59.999Z"), subtotal: 4_000 }),
      ],
      [],
      THIS_MONTH,
    );

    expect(kpis.sales).toBe(6_000);
  });

  it("totals a whole year", () => {
    const year = periodRange("this-year", NOW);
    const kpis = periodKpis(
      [
        sale({ date: new Date("2026-01-15T06:00:00Z"), subtotal: 1_000 }),
        sale({ date: new Date("2026-09-15T06:00:00Z"), subtotal: 2_000 }),
        sale({ date: new Date("2025-12-31T06:00:00Z"), subtotal: 4_000 }),
      ],
      [],
      year,
    );

    expect(kpis.sales).toBe(3_000);
  });
});

describe("marginPercent", () => {
  it.each([
    [0, 0, null],
    [0, -500, null],
    [100_000, 25_000, 25],
    [300, 100, 33.3],
    [100_000, -12_500, -12.5],
  ])("sales %i, profit %i -> %s", (sales, profit, expected) => {
    expect(marginPercent(sales, profit)).toBe(expected);
  });
});

describe("monthlyBuckets", () => {
  it("returns the last twelve months, oldest first, ending with the current month", () => {
    const buckets = monthlyBuckets([], [], NOW);

    expect(buckets).toHaveLength(SUMMARY_MONTHS);
    expect(buckets.map((bucket) => bucket.key)).toEqual([
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
    ]);
  });

  it("includes the empty months, as zeros", () => {
    const buckets = monthlyBuckets([sale({ subtotal: 5_000 })], [], NOW);

    const empty = buckets.slice(0, -1);
    expect(empty).toHaveLength(11);
    for (const bucket of empty) {
      expect(bucket).toMatchObject({
        sales: 0,
        costOfGoods: 0,
        grossProfit: 0,
        investments: 0,
      });
    }
    expect(buckets[11].sales).toBe(5_000);
  });

  it("crosses the year boundary", () => {
    const buckets = monthlyBuckets([], [], new Date("2026-02-10T18:00:00Z"));

    expect(buckets[0]).toMatchObject({ key: "2025-03", year: 2025, month: 3 });
    expect(buckets[11]).toMatchObject({ key: "2026-02", year: 2026, month: 2 });
  });

  it("starts each month at midnight on the 1st in Mexico City", () => {
    const buckets = monthlyBuckets([], [], NOW);

    expect(buckets[0].start.toISOString()).toBe("2025-11-01T06:00:00.000Z");
    expect(buckets[11].start.toISOString()).toBe("2026-10-01T06:00:00.000Z");
  });

  it("puts a sale in its MEXICO month, whatever month it is in UTC", () => {
    const buckets = monthlyBuckets(
      [
        // 23:59:59.999 on September 30th in Mexico City (already October in UTC).
        sale({ date: new Date("2026-10-01T05:59:59.999Z"), subtotal: 1_000 }),
        // 00:00 on October 1st in Mexico City.
        sale({ date: new Date("2026-10-01T06:00:00.000Z"), subtotal: 2_000 }),
        // 21:00 on October 31st in Mexico City (already November in UTC).
        sale({ date: new Date("2026-11-01T03:00:00.000Z"), subtotal: 4_000 }),
      ],
      [],
      NOW,
    );

    expect(buckets.find((bucket) => bucket.key === "2026-09")?.sales).toBe(1_000);
    expect(buckets.find((bucket) => bucket.key === "2026-10")?.sales).toBe(6_000);
  });

  it("takes the offset from the zone itself, so a date from the daylight-saving years lands right", () => {
    // Until 2022 Mexico City observed daylight saving: UTC-5 in the summer.
    const june2022 = new Date("2022-06-15T18:00:00Z");
    const buckets = monthlyBuckets(
      [
        // 23:59:59.999 on April 30th, 2022 in Mexico City (UTC-5).
        sale({ date: new Date("2022-05-01T04:59:59.999Z"), subtotal: 1_000 }),
        // 00:00 on May 1st, 2022 in Mexico City.
        sale({ date: new Date("2022-05-01T05:00:00.000Z"), subtotal: 2_000 }),
      ],
      [],
      june2022,
    );

    expect(buckets.find((bucket) => bucket.key === "2022-04")?.sales).toBe(1_000);
    expect(buckets.find((bucket) => bucket.key === "2022-05")?.sales).toBe(2_000);
    expect(buckets.find((bucket) => bucket.key === "2022-05")?.start.toISOString()).toBe(
      "2022-05-01T05:00:00.000Z",
    );
  });

  it("counts a month's ventas, cost and profit without voided sales or shipping", () => {
    const buckets = monthlyBuckets(
      [
        sale({ subtotal: 100_000, shipping: 15_000, total: 115_000, costOfGoods: 40_000 }),
        sale({ subtotal: 50_000, costOfGoods: 10_000 }),
        sale({ status: "void", subtotal: 900_000, costOfGoods: 1_000 }),
      ],
      [],
      NOW,
    );

    expect(buckets[11]).toMatchObject({
      sales: 150_000,
      costOfGoods: 50_000,
      grossProfit: 100_000,
    });
  });

  it("sums the purchases of each month as inversiones", () => {
    const buckets = monthlyBuckets(
      [],
      [
        purchase({ date: new Date("2026-10-02T06:00:00Z"), totalCost: 30_000 }),
        purchase({ date: new Date("2026-10-20T06:00:00Z"), totalCost: 20_000 }),
        purchase({ date: new Date("2026-07-05T06:00:00Z"), totalCost: 7_000 }),
      ],
      NOW,
    );

    expect(buckets.find((bucket) => bucket.key === "2026-10")?.investments).toBe(50_000);
    expect(buckets.find((bucket) => bucket.key === "2026-07")?.investments).toBe(7_000);
  });

  it("shows a month whose cost is above its sales as a negative gross profit", () => {
    const buckets = monthlyBuckets(
      [sale({ subtotal: 10_000, costOfGoods: 25_000 })],
      [],
      NOW,
    );

    expect(buckets[11].grossProfit).toBe(-15_000);
  });

  it("ignores what falls outside the twelve months, and documents with no date", () => {
    const buckets = monthlyBuckets(
      [
        sale({ date: new Date("2025-10-15T06:00:00Z"), subtotal: 1_000 }), // a month too old
        sale({ date: new Date("2026-11-15T06:00:00Z"), subtotal: 2_000 }), // next month
        sale({ date: null, subtotal: 4_000 }),
      ],
      [
        purchase({ date: new Date("2025-10-15T06:00:00Z"), totalCost: 10 }),
        purchase({ date: null, totalCost: 20 }),
      ],
      NOW,
    );

    expect(buckets.reduce((sum, bucket) => sum + bucket.sales, 0)).toBe(0);
    expect(buckets.reduce((sum, bucket) => sum + bucket.investments, 0)).toBe(0);
  });

  it("keeps the current month's bucket equal to the period KPIs for the same month", () => {
    const sales = [
      sale({ subtotal: 100_000, costOfGoods: 40_000 }),
      sale({ subtotal: 25_000, costOfGoods: 5_000, status: "void" }),
    ];
    const purchases = [purchase({ totalCost: 30_000 })];

    const bucket = monthlyBuckets(sales, purchases, NOW)[11];
    const kpis = periodKpis(sales, purchases, THIS_MONTH);

    expect(bucket.sales).toBe(kpis.sales);
    expect(bucket.grossProfit).toBe(kpis.grossProfit);
    expect(bucket.investments).toBe(kpis.investments);
  });
});

describe("ledgerWindow", () => {
  it("is the chart's twelve months when the period is inside them", () => {
    const window = ledgerWindow(THIS_MONTH, NOW);

    expect(window.start.toISOString()).toBe("2025-11-01T06:00:00.000Z");
    expect(window.end.toISOString()).toBe("2026-11-01T06:00:00.000Z");
  });

  it("reaches to the end of the year when the period is this year", () => {
    const window = ledgerWindow(periodRange("this-year", NOW), NOW);

    // The chart starts in November 2025, earlier than January; the year ends
    // in January 2027, later than the chart's last month.
    expect(window.start.toISOString()).toBe("2025-11-01T06:00:00.000Z");
    expect(window.end.toISOString()).toBe("2027-01-01T06:00:00.000Z");
  });

  it("is still the chart's months for last month right after New Year", () => {
    const january = new Date("2026-01-15T18:00:00Z");
    const window = ledgerWindow(periodRange("last-month", january), january);

    expect(window.start.toISOString()).toBe("2025-02-01T06:00:00.000Z");
    expect(window.end.toISOString()).toBe("2026-02-01T06:00:00.000Z");
  });

  it.each(["this-month", "last-month", "this-year"] as const)(
    "always contains both the %s period and every month of the chart",
    (key) => {
      const range = periodRange(key, NOW);
      const window = ledgerWindow(range, NOW);
      const months = monthlyBuckets([], [], NOW);

      expect(window.start.getTime()).toBeLessThanOrEqual(range.start.getTime());
      expect(window.end.getTime()).toBeGreaterThanOrEqual(range.end.getTime());
      expect(window.start.getTime()).toBeLessThanOrEqual(months[0].start.getTime());
      expect(window.end.getTime()).toBeGreaterThan(months[11].start.getTime());
    },
  );
});

describe("inventoryTotal", () => {
  it("is the sum of each material's stock times its average cost", () => {
    expect(
      inventoryTotal([
        { stock: 10.5, avgCost: 1_800 }, // 18_900
        { stock: 3, avgCost: 33 }, // 99
      ]),
    ).toBe(18_999);
  });

  it("values nothing on hand, or a negative balance, at zero", () => {
    expect(
      inventoryTotal([
        { stock: 0, avgCost: 999 },
        { stock: -1, avgCost: 500 },
      ]),
    ).toBe(0);
  });

  it("rounds each material to the centavo, as the Inventario page does", () => {
    // 2.5 x 1 centavo is 3 (half rounds up) per material: 6 together, not 5.
    expect(
      inventoryTotal([
        { stock: 2.5, avgCost: 1 },
        { stock: 2.5, avgCost: 1 },
      ]),
    ).toBe(6);
  });

  it("is zero with no materials", () => {
    expect(inventoryTotal([])).toBe(0);
  });

  it("stays in whole centavos", () => {
    const total = inventoryTotal([
      { stock: 0.33, avgCost: 1_234 },
      { stock: 7.77, avgCost: 4_321 },
    ]);

    expect(Number.isSafeInteger(total)).toBe(true);
  });
});

describe("countPieces", () => {
  it("counts the available pieces and the sold ones", () => {
    expect(
      countPieces([
        { availability: "available" },
        { availability: "available" },
        { availability: "sold" },
      ]),
    ).toEqual({ available: 2, sold: 1 });
  });

  it("treats anything but 'available' as sold, so a doubtful piece never looks sellable", () => {
    expect(
      countPieces([{ availability: "available" }, { availability: "weird" }]),
    ).toEqual({ available: 1, sold: 1 });
  });

  it("is zero and zero with an empty catalog", () => {
    expect(countPieces([])).toEqual({ available: 0, sold: 0 });
  });
});
