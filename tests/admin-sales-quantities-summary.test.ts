import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeFirestore, FakeTimestamp } from "@/tests/helpers/fake-firestore";

// End to end over the ledger, with Firestore faked at the edge: a sale of
// several units is RECORDED (the real recorder, the real frozen cost), then
// READ BACK by the Ventas totals and by the Resumen dashboard. What this pins
// is that money (ventas, cost of goods, gross profit, the monthly chart) counts
// every unit, and that the two screens agree.
vi.mock("server-only", () => ({}));

vi.mock("firebase-admin/firestore", async () => {
  const fake = await import("@/tests/helpers/fake-firestore");
  return {
    FieldValue: { serverTimestamp: () => fake.SERVER_TIMESTAMP },
    Timestamp: { fromDate: (date: Date) => new fake.FakeTimestamp(date) },
  };
});

let fake: FakeFirestore;
vi.mock("@/lib/admin/firebase/admin", () => ({
  getAdminDb: () => fake,
}));

const getCatalogProductsMock = vi.fn();
vi.mock("@/lib/admin/data/catalog", () => ({
  getCatalogProducts: (...args: unknown[]) => getCatalogProductsMock(...args),
}));

vi.mock("@/lib/admin/data/stripe-fees", () => ({
  fetchStripeFees: vi.fn(),
}));

import { listSales, recordManualSale, sumSales } from "@/lib/admin/data/sales";
import { readSummaryLedger } from "@/lib/admin/data/summary";
import type { PeriodRange } from "@/lib/admin/domain/periods";
import { monthlyBuckets, periodKpis } from "@/lib/admin/domain/summary";

const ACTOR = "uid-admin-1";
const DATE = new Date("2026-10-02T06:00:00.000Z");
const NOW = new Date("2026-10-15T18:00:00.000Z");
const OCTOBER: PeriodRange = {
  start: new Date("2026-10-01T06:00:00Z"),
  end: new Date("2026-11-01T06:00:00Z"),
};
const YEAR: PeriodRange = {
  start: new Date("2026-01-01T06:00:00Z"),
  end: new Date("2027-01-01T06:00:00Z"),
};

beforeEach(() => {
  vi.resetAllMocks();
  fake = new FakeFirestore();
  getCatalogProductsMock.mockImplementation(async (handles: string[]) => {
    const catalog = [
      { handle: "anillo-luna", title: "Anillo Luna", price: 185_000, stock: 10 },
      { handle: "aretes-sol", title: "Aretes Sol", price: 90_000, stock: 10 },
    ];
    return new Map(
      catalog
        .filter((entry) => handles.includes(entry.handle))
        .map(
          (entry) =>
            [
              entry.handle,
              { ...entry, availability: "available", categoryTitle: null },
            ] as const,
        ),
    );
  });
  // 60_000 and 10_000 of cost for ONE unit of each piece.
  fake.seed("pieces/anillo-luna", { costs: { metal: 40_000, stones: 15_000, other: 5_000 } });
  fake.seed("pieces/aretes-sol", { costs: { metal: 10_000, stones: 0, other: 0 } });
});

async function sellThreeRingsAndTwoEarrings() {
  await recordManualSale(
    {
      date: DATE,
      items: [
        { handle: "anillo-luna", price: 185_000, quantity: 3 },
        { handle: "aretes-sol", price: 80_000, quantity: 2 },
      ],
      shipping: 15_000,
    },
    ACTOR,
  );
}

describe("a sale of several units, in the totals and the summary", () => {
  it("counts every unit in the Ventas totals: sales, cost of goods and gross profit", async () => {
    await sellThreeRingsAndTwoEarrings();

    const total = await sumSales(OCTOBER);

    // 3 x 185_000 + 2 x 80_000 sold; 3 x 60_000 + 2 x 10_000 of cost.
    expect(total).toMatchObject({
      count: 1,
      subtotal: 715_000,
      shipping: 15_000,
      total: 730_000,
      costOfGoods: 200_000,
      grossProfit: 515_000,
    });
  });

  it("counts every unit in the Resumen KPIs, the same figures as Ventas", async () => {
    await sellThreeRingsAndTwoEarrings();

    const ledger = await readSummaryLedger(YEAR);
    const kpis = periodKpis(ledger?.sales ?? [], ledger?.purchases ?? [], OCTOBER);
    const total = await sumSales(OCTOBER);

    expect(kpis).toMatchObject({
      salesCount: 1,
      sales: 715_000,
      costOfGoods: 200_000,
      grossProfit: 515_000,
      pendingCostCount: 0,
    });
    // The two screens can never disagree about a sale.
    expect(kpis.sales).toBe(total?.subtotal);
    expect(kpis.costOfGoods).toBe(total?.costOfGoods);
    expect(kpis.grossProfit).toBe(total?.grossProfit);
  });

  it("counts every unit in the twelve-month chart", async () => {
    await sellThreeRingsAndTwoEarrings();

    const ledger = await readSummaryLedger(YEAR);
    const october = monthlyBuckets(ledger?.sales ?? [], ledger?.purchases ?? [], NOW).find(
      (bucket) => bucket.key === "2026-10",
    );

    expect(october).toMatchObject({
      sales: 715_000,
      costOfGoods: 200_000,
      grossProfit: 515_000,
    });
  });

  it("adds a sale of one unit and a sale of several up, month by month", async () => {
    await sellThreeRingsAndTwoEarrings();
    await recordManualSale(
      {
        date: DATE,
        items: [{ handle: "aretes-sol", price: 90_000, quantity: 1 }],
        shipping: 0,
      },
      ACTOR,
    );

    const total = await sumSales(OCTOBER);

    expect(total).toMatchObject({
      count: 2,
      subtotal: 715_000 + 90_000,
      costOfGoods: 200_000 + 10_000,
    });
  });

  it("reads the quantity back on the sale's lines, so the list can show '× 3'", async () => {
    await sellThreeRingsAndTwoEarrings();

    const page = await listSales(OCTOBER);

    expect(page?.sales[0].items.map((item) => [item.handle, item.quantity])).toEqual([
      ["anillo-luna", 3],
      ["aretes-sol", 2],
    ]);
  });

  it("leaves a sale from before quantities existed exactly as it was: each line counts once", async () => {
    fake.seed("sales/antigua", {
      source: "manual",
      status: "active",
      date: new FakeTimestamp(DATE),
      items: [{ handle: "anillo-luna", title: "Anillo Luna", price: 185_000 }],
      subtotal: 185_000,
      shipping: 0,
      total: 185_000,
      costOfGoods: 60_000,
      costPending: false,
    });

    const total = await sumSales(OCTOBER);
    const page = await listSales(OCTOBER);

    expect(total).toMatchObject({ subtotal: 185_000, costOfGoods: 60_000 });
    expect(page?.sales[0].items[0].quantity).toBe(1);
  });
});
