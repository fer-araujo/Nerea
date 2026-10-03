import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Query } from "firebase-admin/firestore";
import { FakeFirestore, FakeTimestamp } from "@/tests/helpers/fake-firestore";

vi.mock("server-only", () => ({}));

vi.mock("firebase-admin/firestore", async () => {
  const fake = await import("@/tests/helpers/fake-firestore");
  return {
    FieldValue: { serverTimestamp: () => fake.SERVER_TIMESTAMP },
    Timestamp: { fromDate: (date: Date) => new fake.FakeTimestamp(date) },
  };
});

let fake: FakeFirestore;
let configured = true;
vi.mock("@/lib/admin/firebase/admin", () => ({
  getAdminDb: () => (configured ? fake : undefined),
}));

import { READ_BATCH_SIZE, readInBatches } from "@/lib/admin/data/batched-read";
import { countUnreadMessages } from "@/lib/admin/data/contact-messages";
import {
  SUMMARY_PURCHASES_LIMIT,
  SUMMARY_SALES_LIMIT,
  readSummaryLedger,
} from "@/lib/admin/data/summary";
import type { PeriodRange } from "@/lib/admin/domain/periods";

// A window of one year, in Mexico City midnights.
const WINDOW: PeriodRange = {
  start: new Date("2026-01-01T06:00:00Z"),
  end: new Date("2027-01-01T06:00:00Z"),
};
const HOUR = 60 * 60 * 1000;

function ts(date: Date) {
  return new FakeTimestamp(date);
}

function seedSale(id: string, overrides: Record<string, unknown> = {}) {
  fake.seed(`sales/${id}`, {
    date: ts(new Date("2026-10-02T06:00:00Z")),
    status: "active",
    subtotal: 100_000,
    shipping: 15_000,
    total: 115_000,
    costOfGoods: 40_000,
    costPending: false,
    // Fields the dashboard must never need.
    source: "manual",
    items: [{ handle: "anillo-luna", title: "Anillo Luna", price: 100_000 }],
    note: "private",
    ...overrides,
  });
}

function seedPurchase(id: string, overrides: Record<string, unknown> = {}) {
  fake.seed(`purchases/${id}`, {
    date: ts(new Date("2026-10-02T06:00:00Z")),
    totalCost: 30_000,
    supplier: "private",
    items: [],
    ...overrides,
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  fake = new FakeFirestore();
  configured = true;
});

describe("readSummaryLedger", () => {
  it("returns the sales and purchases dated inside the window, newest first", async () => {
    seedSale("old", { date: ts(new Date("2026-03-01T06:00:00Z")), subtotal: 1_000 });
    seedSale("new", { date: ts(new Date("2026-10-02T06:00:00Z")), subtotal: 2_000 });
    seedSale("outside", { date: ts(new Date("2025-12-31T06:00:00Z")), subtotal: 9_999 });
    seedPurchase("p-old", { date: ts(new Date("2026-02-01T06:00:00Z")), totalCost: 10 });
    seedPurchase("p-new", { date: ts(new Date("2026-09-01T06:00:00Z")), totalCost: 20 });
    seedPurchase("p-after", { date: ts(new Date("2027-01-01T06:00:00Z")), totalCost: 99 });

    const ledger = await readSummaryLedger(WINDOW);

    expect(ledger?.sales.map((sale) => sale.subtotal)).toEqual([2_000, 1_000]);
    expect(ledger?.purchases.map((purchase) => purchase.totalCost)).toEqual([20, 10]);
    expect(ledger?.truncated).toBe(false);
  });

  it("reads each document as the figures the dashboard needs", async () => {
    seedSale("a", { status: "void", costPending: true, costOfGoods: 7_000 });

    const ledger = await readSummaryLedger(WINDOW);

    expect(ledger?.sales).toEqual([
      {
        date: new Date("2026-10-02T06:00:00Z"),
        status: "void",
        subtotal: 100_000,
        shipping: 15_000,
        total: 115_000,
        costOfGoods: 7_000,
        costPending: true,
      },
    ]);
  });

  it("coerces a hand-edited document instead of trusting its shape", async () => {
    seedSale("odd", {
      status: "refunded",
      subtotal: "lots",
      shipping: -5,
      total: 1.5,
      costOfGoods: null,
      costPending: "yes",
    });
    seedPurchase("odd", { totalCost: "free" });

    const ledger = await readSummaryLedger(WINDOW);

    expect(ledger?.sales[0]).toMatchObject({
      status: "active",
      subtotal: 0,
      shipping: 0,
      total: 0,
      costOfGoods: 0,
      costPending: false,
    });
    expect(ledger?.purchases[0].totalCost).toBe(0);
  });

  it("uses single-field queries only: a date range ordered by date, projecting just the figures it needs", async () => {
    seedSale("a");
    seedPurchase("a");

    // The fake throws on anything that would need a composite index, so a
    // resolved read is already the proof; the records show the shape.
    await readSummaryLedger(WINDOW);

    const salesQuery = fake.queries.find((query) => query.collection === "sales");
    const purchasesQuery = fake.queries.find((query) => query.collection === "purchases");

    for (const query of [salesQuery, purchasesQuery]) {
      expect(query?.wheres.map((where) => [where.field, where.op])).toEqual([
        ["date", ">="],
        ["date", "<"],
      ]);
      expect(query?.orderBys).toEqual([{ field: "date", direction: "desc" }]);
      expect(query?.offset).toBeUndefined();
    }
    expect(salesQuery?.select).toEqual([
      "date",
      "status",
      "subtotal",
      "shipping",
      "total",
      "costOfGoods",
      "costPending",
    ]);
    expect(purchasesQuery?.select).toEqual(["date", "totalCost"]);
  });

  it("reads in batches of 500 with a cursor, losing nothing even when many sales share one date", async () => {
    // 1200 sales on the SAME business date: the worst case for a cursor.
    for (let index = 1; index <= 1200; index += 1) {
      seedSale(`s${String(index).padStart(4, "0")}`, { subtotal: index });
    }

    const ledger = await readSummaryLedger(WINDOW);

    expect(ledger?.sales).toHaveLength(1200);
    expect(ledger?.sales.reduce((sum, sale) => sum + sale.subtotal, 0)).toBe(
      (1200 * 1201) / 2,
    );
    expect(ledger?.truncated).toBe(false);

    const salesQueries = fake.queries.filter((query) => query.collection === "sales");
    expect(salesQueries.map((query) => query.limit)).toEqual([500, 500, 500]);
    expect(salesQueries[0].startAfter).toBeUndefined();
    expect(salesQueries[1].startAfter).toBeDefined();
    expect(salesQueries.every((query) => query.offset === undefined)).toBe(true);
  });

  it("flags `truncated` and keeps the NEWEST sales when the cap is crossed", async () => {
    // One sale per hour from the start of the window: index 0 is the oldest.
    for (let index = 0; index <= SUMMARY_SALES_LIMIT; index += 1) {
      seedSale(`s${String(index).padStart(4, "0")}`, {
        date: ts(new Date(WINDOW.start.getTime() + index * HOUR)),
        subtotal: index + 1,
      });
    }

    const ledger = await readSummaryLedger(WINDOW);

    expect(ledger?.truncated).toBe(true);
    expect(ledger?.sales).toHaveLength(SUMMARY_SALES_LIMIT);
    // The oldest sale is the one left out.
    expect(ledger?.sales.some((sale) => sale.subtotal === 1)).toBe(false);
    expect(ledger?.sales[0].subtotal).toBe(SUMMARY_SALES_LIMIT + 1);
  });

  it("does not call a list that is exactly at its cap truncated", async () => {
    for (let index = 0; index < SUMMARY_SALES_LIMIT; index += 1) {
      seedSale(`s${String(index).padStart(4, "0")}`, {
        date: ts(new Date(WINDOW.start.getTime() + index * HOUR)),
      });
    }

    const ledger = await readSummaryLedger(WINDOW);

    expect(ledger?.sales).toHaveLength(SUMMARY_SALES_LIMIT);
    expect(ledger?.truncated).toBe(false);
  });

  it("flags `truncated` when the purchases cross their own cap", async () => {
    for (let index = 0; index <= SUMMARY_PURCHASES_LIMIT; index += 1) {
      seedPurchase(`p${String(index).padStart(4, "0")}`, {
        date: ts(new Date(WINDOW.start.getTime() + index * HOUR)),
        totalCost: 1,
      });
    }

    const ledger = await readSummaryLedger(WINDOW);

    expect(ledger?.truncated).toBe(true);
    expect(ledger?.purchases).toHaveLength(SUMMARY_PURCHASES_LIMIT);
    expect(ledger?.sales).toEqual([]);
  });

  it("returns an empty, complete ledger when there is nothing in the window", async () => {
    const ledger = await readSummaryLedger(WINDOW);

    expect(ledger).toEqual({ sales: [], purchases: [], truncated: false });
  });

  it("returns null when Firebase isn't configured, without reading anything", async () => {
    configured = false;

    expect(await readSummaryLedger(WINDOW)).toBeNull();
    expect(fake.queries).toHaveLength(0);
  });
});

describe("countUnreadMessages", () => {
  it("counts the unread messages with one equality filter and the count aggregation", async () => {
    fake.seed("contactMessages/a", { read: false, name: "Ana", email: "ana@example.com" });
    fake.seed("contactMessages/b", { read: true, name: "Beto", email: "beto@example.com" });
    fake.seed("contactMessages/c", { read: false, name: "Cris", email: "cris@example.com" });

    expect(await countUnreadMessages()).toBe(2);

    expect(fake.queries).toHaveLength(1);
    expect(fake.queries[0]).toMatchObject({
      collection: "contactMessages",
      aggregate: "count",
      wheres: [{ field: "read", op: "==", value: false }],
      orderBys: [],
    });
  });

  it("is zero for an empty inbox", async () => {
    expect(await countUnreadMessages()).toBe(0);
  });

  it("returns null when Firebase isn't configured", async () => {
    configured = false;

    expect(await countUnreadMessages()).toBeNull();
  });
});

describe("readInBatches", () => {
  function seedThings(total: number) {
    for (let index = 1; index <= total; index += 1) {
      fake.seed(`things/t${String(index).padStart(3, "0")}`, { n: index });
    }
  }

  function read(limit: number, batchSize: number) {
    return readInBatches(
      fake.collection("things").orderBy("n") as unknown as Query,
      (doc) => doc.data().n as number,
      { limit, batchSize },
    );
  }

  it("asks for 500 documents at a time by default", async () => {
    expect(READ_BATCH_SIZE).toBe(500);
  });

  it("returns everything, and not truncated, when the query is under the cap", async () => {
    seedThings(3);

    const result = await read(5, 2);

    expect(result).toEqual({ rows: [1, 2, 3], truncated: false });
  });

  it("is not truncated when the query holds exactly the cap", async () => {
    seedThings(5);

    const result = await read(5, 2);

    expect(result).toEqual({ rows: [1, 2, 3, 4, 5], truncated: false });
  });

  it("is truncated, with only the first `limit` rows, when the query holds more", async () => {
    seedThings(7);

    const result = await read(5, 2);

    expect(result).toEqual({ rows: [1, 2, 3, 4, 5], truncated: true });
  });

  it("copes with a cap that is a whole number of batches", async () => {
    seedThings(4);
    expect(await read(4, 2)).toEqual({ rows: [1, 2, 3, 4], truncated: false });

    seedThings(5);
    expect(await read(4, 2)).toEqual({ rows: [1, 2, 3, 4], truncated: true });
  });

  it("never asks for more than a batch, and stops as soon as the cap is known", async () => {
    seedThings(50);

    await read(5, 2);

    expect(fake.queries.map((query) => query.limit)).toEqual([2, 2, 2]);
  });

  it("is an empty, complete read for an empty collection", async () => {
    expect(await read(5, 2)).toEqual({ rows: [], truncated: false });
    expect(fake.queries).toHaveLength(1);
  });
});
