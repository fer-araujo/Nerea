import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUDIT_PATH,
  FakeFirestore,
  FakeTimestamp,
  MATERIAL_PATH,
  MOVEMENT_PATH,
  PURCHASE_PATH,
  SERVER_TIMESTAMP,
  type FakeOp,
} from "@/tests/helpers/fake-firestore";

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

import {
  PURCHASES_PAGE_SIZE,
  PURCHASE_SUM_LIMIT,
  listPurchases,
  recordPurchase,
  sumPurchases,
  type RecordPurchaseInput,
} from "@/lib/admin/data/purchases";
import { InventoryError, MAX_PURCHASE_ITEMS } from "@/lib/admin/domain/inventory";
import { periodRange } from "@/lib/admin/domain/periods";

const ACTOR = "uid-admin-1";
const DATE = new Date("2026-10-01T06:00:00.000Z");

function seedMaterial(id: string, overrides: Record<string, unknown> = {}) {
  fake.seed(`materials/${id}`, {
    name: "Plata fina",
    kind: "fine_silver",
    unit: "g",
    stock: 10,
    avgCost: 1000,
    createdAt: new FakeTimestamp(new Date("2026-09-01T12:00:00Z")),
    updatedAt: new FakeTimestamp(new Date("2026-09-01T12:00:00Z")),
    ...overrides,
  });
}

function dataOf(op: FakeOp | undefined): Record<string, unknown> {
  if (!op || op.kind === "delete") {
    throw new Error("expected a write operation");
  }
  return op.data;
}

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return error instanceof InventoryError ? error.code : "not-an-inventory-error";
  }
  return undefined;
}

beforeEach(() => {
  fake = new FakeFirestore();
  configured = true;
});

describe("recordPurchase: weighted average cost", () => {
  it("re-averages, adds stock, appends a purchase movement and writes the receipt", async () => {
    seedMaterial("m1"); // 10 g @ $10.00

    const recorded = await recordPurchase(
      {
        date: DATE,
        supplier: "Proveedor Uno",
        note: "Factura 12",
        items: [{ materialId: "m1", qty: 5, totalCost: 9000 }],
      },
      ACTOR,
    );

    expect(recorded).toEqual({ id: expect.any(String) });
    expect(fake.transactionsRun).toBe(1);

    // (10 x 1000 + 9000) / 15 = 1266.67 -> 1267
    expect(fake.get("materials/m1")).toMatchObject({ stock: 15, avgCost: 1267 });

    const movement = dataOf(fake.opsMatching(MOVEMENT_PATH, "create")[0]);
    expect(movement).toEqual({
      type: "purchase",
      qty: 5,
      unitCost: 1800,
      totalCost: 9000,
      refId: recorded?.id,
      createdAt: SERVER_TIMESTAMP,
      actor: ACTOR,
    });

    const receipt = fake.get(`purchases/${recorded?.id}`);
    expect(receipt).toMatchObject({
      supplier: "Proveedor Uno",
      note: "Factura 12",
      items: [
        { materialId: "m1", materialName: "Plata fina", qty: 5, totalCost: 9000 },
      ],
      totalCost: 9000,
      actor: ACTOR,
    });
    expect((receipt?.date as FakeTimestamp).toDate()).toEqual(DATE);
  });

  it("prices a first purchase at cost / qty (nothing on hand to average with)", async () => {
    seedMaterial("m1", { stock: 0, avgCost: 987_654 });

    await recordPurchase(
      { date: DATE, items: [{ materialId: "m1", qty: 4, totalCost: 10_001 }] },
      ACTOR,
    );

    // 10001 / 4 = 2500.25 -> 2500; the stale average is ignored.
    expect(fake.get("materials/m1")).toMatchObject({ stock: 4, avgCost: 2500 });
  });

  it("records several materials in ONE purchase and sums the total", async () => {
    seedMaterial("m1");
    seedMaterial("m3", { name: "Liga", kind: "alloy", stock: 0, avgCost: 0 });

    const recorded = await recordPurchase(
      {
        date: DATE,
        items: [
          { materialId: "m1", qty: 5, totalCost: 9000 },
          { materialId: "m3", qty: 20, totalCost: 2000 },
        ],
      },
      ACTOR,
    );

    expect(fake.get("materials/m1")).toMatchObject({ stock: 15, avgCost: 1267 });
    expect(fake.get("materials/m3")).toMatchObject({ stock: 20, avgCost: 100 });

    const receipt = fake.get(`purchases/${recorded?.id}`);
    expect(receipt?.totalCost).toBe(11_000);
    expect(receipt?.items).toEqual([
      { materialId: "m1", materialName: "Plata fina", qty: 5, totalCost: 9000 },
      { materialId: "m3", materialName: "Liga", qty: 20, totalCost: 2000 },
    ]);
    expect(fake.opsMatching(MOVEMENT_PATH, "create")).toHaveLength(2);
  });

  it("averages two lines for the SAME material exactly like two purchases would", async () => {
    seedMaterial("m1", { stock: 0, avgCost: 0 });

    await recordPurchase(
      {
        date: DATE,
        items: [
          { materialId: "m1", qty: 10, totalCost: 10_000 },
          { materialId: "m1", qty: 5, totalCost: 9000 },
        ],
      },
      ACTOR,
    );

    expect(fake.get("materials/m1")).toMatchObject({ stock: 15, avgCost: 1267 });
    // One write per material, with the final state; one movement per line.
    expect(fake.opsMatching(MATERIAL_PATH, "update")).toHaveLength(1);
    expect(fake.opsMatching(MOVEMENT_PATH, "create")).toHaveLength(2);
  });

  it("takes material names from the database, never from the caller", async () => {
    seedMaterial("m1");

    const recorded = await recordPurchase(
      {
        date: DATE,
        items: [
          { materialId: "m1", qty: 1, totalCost: 100, materialName: "Hacked" },
        ],
      } as unknown as RecordPurchaseInput,
      ACTOR,
    );

    const receipt = fake.get(`purchases/${recorded?.id}`);
    expect(JSON.stringify(receipt)).not.toContain("Hacked");
    expect(receipt?.items).toEqual([
      { materialId: "m1", materialName: "Plata fina", qty: 1, totalCost: 100 },
    ]);
  });

  it("omits optional fields it was not given instead of storing undefined", async () => {
    seedMaterial("m1");

    const recorded = await recordPurchase(
      { date: DATE, items: [{ materialId: "m1", qty: 1, totalCost: 100 }] },
      ACTOR,
    );

    const receipt = fake.get(`purchases/${recorded?.id}`);
    expect(receipt).not.toHaveProperty("supplier");
    expect(receipt).not.toHaveProperty("note");
  });

  it("uses a server timestamp for createdAt, never the client's clock", async () => {
    seedMaterial("m1");

    await recordPurchase(
      { date: DATE, items: [{ materialId: "m1", qty: 1, totalCost: 100 }] },
      ACTOR,
    );

    const receiptOp = fake.opsMatching(PURCHASE_PATH, "create")[0];
    expect(dataOf(receiptOp).createdAt).toBe(SERVER_TIMESTAMP);
  });
});

describe("recordPurchase: all or nothing", () => {
  it("writes NOTHING when a later line names an unknown material", async () => {
    seedMaterial("m1");

    await expect(
      codeOf(
        recordPurchase(
          {
            date: DATE,
            items: [
              { materialId: "m1", qty: 5, totalCost: 9000 },
              { materialId: "ghost", qty: 1, totalCost: 100 },
            ],
          },
          ACTOR,
        ),
      ),
    ).resolves.toBe("material-not-found");

    expect(fake.committed).toHaveLength(0);
    expect(fake.get("materials/m1")).toMatchObject({ stock: 10, avgCost: 1000 });
  });

  it("writes NOTHING when a quantity does not fit the unit", async () => {
    seedMaterial("m1");
    seedMaterial("m2", { name: "Circón", kind: "stone", unit: "pz", stock: 0, avgCost: 0 });

    await expect(
      codeOf(
        recordPurchase(
          {
            date: DATE,
            items: [
              { materialId: "m1", qty: 5, totalCost: 9000 },
              { materialId: "m2", qty: 1.5, totalCost: 300 },
            ],
          },
          ACTOR,
        ),
      ),
    ).resolves.toBe("invalid-quantity");

    expect(fake.committed).toHaveLength(0);
    expect(fake.get("materials/m1")).toMatchObject({ stock: 10 });
  });

  it("rejects a fractional or negative cost before opening a transaction", async () => {
    seedMaterial("m1");

    await expect(
      codeOf(
        recordPurchase(
          { date: DATE, items: [{ materialId: "m1", qty: 1, totalCost: 10.5 }] },
          ACTOR,
        ),
      ),
    ).resolves.toBe("invalid-cost");
    await expect(
      codeOf(
        recordPurchase(
          { date: DATE, items: [{ materialId: "m1", qty: 1, totalCost: -1 }] },
          ACTOR,
        ),
      ),
    ).resolves.toBe("invalid-cost");
    expect(fake.transactionsRun).toBe(0);
  });

  it("rejects an empty purchase and one with too many lines, without a transaction", async () => {
    await expect(codeOf(recordPurchase({ date: DATE, items: [] }, ACTOR))).resolves.toBe(
      "invalid-quantity",
    );

    const tooMany = Array.from({ length: MAX_PURCHASE_ITEMS + 1 }, () => ({
      materialId: "m1",
      qty: 1,
      totalCost: 100,
    }));
    await expect(
      codeOf(recordPurchase({ date: DATE, items: tooMany }, ACTOR)),
    ).resolves.toBe("invalid-quantity");
    expect(fake.transactionsRun).toBe(0);
  });

  it("refuses a malformed material id, which could address another path", async () => {
    await expect(
      codeOf(
        recordPurchase(
          { date: DATE, items: [{ materialId: "a/b/c", qty: 1, totalCost: 100 }] },
          ACTOR,
        ),
      ),
    ).resolves.toBe("material-not-found");
    expect(fake.transactionsRun).toBe(0);
  });
});

describe("recordPurchase: audit and append-only ledger", () => {
  it("writes an audit entry with no values", async () => {
    seedMaterial("m1");

    const recorded = await recordPurchase(
      {
        date: DATE,
        supplier: "Proveedor secreto",
        items: [{ materialId: "m1", qty: 5, totalCost: 9000 }],
      },
      ACTOR,
    );

    const audit = fake.opsMatching(AUDIT_PATH, "create")[0];
    expect(dataOf(audit)).toEqual({
      actor: ACTOR,
      action: "purchase.record",
      entity: "purchase",
      entityId: recorded?.id,
      at: SERVER_TIMESTAMP,
    });
    expect(JSON.stringify(audit)).not.toContain("secreto");
    expect(JSON.stringify(audit)).not.toContain("9000");
  });

  it("only ever creates movements, one new document per purchase line", async () => {
    seedMaterial("m1");

    await recordPurchase(
      { date: DATE, items: [{ materialId: "m1", qty: 1, totalCost: 100 }] },
      ACTOR,
    );
    await recordPurchase(
      { date: DATE, items: [{ materialId: "m1", qty: 2, totalCost: 200 }] },
      ACTOR,
    );

    const movementOps = fake.opsMatching(MOVEMENT_PATH);
    expect(movementOps).toHaveLength(2);
    expect(movementOps.every((op) => op.kind === "create")).toBe(true);
    expect(new Set(movementOps.map((op) => op.path)).size).toBe(2);
  });

  it("returns null and writes nothing when Firebase is not configured", async () => {
    configured = false;

    await expect(
      recordPurchase(
        { date: DATE, items: [{ materialId: "m1", qty: 1, totalCost: 100 }] },
        ACTOR,
      ),
    ).resolves.toBeNull();
  });
});

function seedPurchase(id: string, date: Date, totalCost: number, extra: Record<string, unknown> = {}) {
  fake.seed(`purchases/${id}`, {
    date: new FakeTimestamp(date),
    items: [
      { materialId: "m1", materialName: "Plata fina", qty: 1, totalCost },
    ],
    totalCost,
    createdAt: new FakeTimestamp(date),
    actor: ACTOR,
    ...extra,
  });
}

describe("listPurchases", () => {
  const OCTOBER = periodRange("this-month", new Date("2026-10-15T12:00:00Z"));

  it("filters by a half-open date range and orders by that same single field", async () => {
    seedPurchase("before", new Date("2026-10-01T05:59:59.999Z"), 100); // Sept 30, Mexico
    seedPurchase("first-instant", new Date("2026-10-01T06:00:00.000Z"), 200);
    seedPurchase("middle", new Date("2026-10-15T18:00:00.000Z"), 300);
    seedPurchase("at-end", new Date("2026-11-01T06:00:00.000Z"), 400); // November

    const page = await listPurchases(OCTOBER);

    // Newest purchase date first; the boundary instants fall on the right side.
    expect(page?.purchases.map((purchase) => purchase.id)).toEqual([
      "middle",
      "first-instant",
    ]);
    expect(fake.queries[0]).toMatchObject({
      collection: "purchases",
      orderBys: [{ field: "date", direction: "desc" }],
      offset: 0,
      limit: PURCHASES_PAGE_SIZE + 1,
    });
    expect(fake.queries[0].wheres.map((where) => [where.field, where.op])).toEqual([
      ["date", ">="],
      ["date", "<"],
    ]);
  });

  it("cuts pages and reports a next page via the extra document", async () => {
    for (let index = 1; index <= PURCHASES_PAGE_SIZE + 1; index += 1) {
      seedPurchase(
        `p${String(index).padStart(3, "0")}`,
        new Date(Date.UTC(2026, 9, 2, 12, index)),
        100,
      );
    }

    const first = await listPurchases(OCTOBER, 1);
    const second = await listPurchases(OCTOBER, 2);

    expect(first?.purchases).toHaveLength(PURCHASES_PAGE_SIZE);
    expect(first?.hasNextPage).toBe(true);
    expect(second?.purchases).toHaveLength(1);
    expect(second?.hasNextPage).toBe(false);
  });

  it("maps a purchase and coerces hand-edited documents", async () => {
    seedPurchase("ok", new Date("2026-10-05T18:00:00Z"), 9000, {
      supplier: "Proveedor Uno",
      note: "Factura 12",
    });
    seedPurchase("odd", new Date("2026-10-04T18:00:00Z"), 0, {
      items: ["junk", { materialId: 5, qty: "x", totalCost: 1.5 }, null],
      totalCost: "lots",
    });

    const page = await listPurchases(OCTOBER);

    expect(page?.purchases[0]).toEqual({
      id: "ok",
      date: new Date("2026-10-05T18:00:00Z"),
      supplier: "Proveedor Uno",
      note: "Factura 12",
      items: [{ materialId: "m1", materialName: "Plata fina", qty: 1, totalCost: 9000 }],
      totalCost: 9000,
    });
    expect(page?.purchases[1]).toEqual({
      id: "odd",
      date: new Date("2026-10-04T18:00:00Z"),
      supplier: null,
      note: null,
      items: [{ materialId: "", materialName: "", qty: 0, totalCost: 0 }],
      totalCost: 0,
    });
  });

  it.each([0, -1, 1.5, Number.NaN, 201, 1e9])(
    "falls back to the first page for the out-of-range page %s",
    async (page) => {
      await listPurchases(OCTOBER, page);

      expect(fake.queries[0].offset).toBe(0);
    },
  );

  it("returns null when Firebase is not configured", async () => {
    configured = false;

    await expect(listPurchases(OCTOBER)).resolves.toBeNull();
  });
});

describe("sumPurchases", () => {
  const OCTOBER = periodRange("this-month", new Date("2026-10-15T12:00:00Z"));

  it("totals EVERY purchase of the period, not just a page", async () => {
    for (let index = 1; index <= PURCHASES_PAGE_SIZE + 5; index += 1) {
      seedPurchase(`p${index}`, new Date(Date.UTC(2026, 9, 2, 12, index)), 1000);
    }
    seedPurchase("september", new Date("2026-09-20T12:00:00Z"), 99_999);

    const total = await sumPurchases(OCTOBER);

    expect(total).toEqual({
      totalCost: (PURCHASES_PAGE_SIZE + 5) * 1000,
      count: PURCHASES_PAGE_SIZE + 5,
      truncated: false,
    });
  });

  it("reads only the totalCost field, with a range on date alone (no composite index)", async () => {
    seedPurchase("p1", new Date("2026-10-02T12:00:00Z"), 500, { supplier: "No me leas" });

    await sumPurchases(OCTOBER);

    expect(fake.queries[0]).toMatchObject({
      collection: "purchases",
      select: ["totalCost"],
      orderBys: [],
    });
    expect(fake.queries[0].wheres.every((where) => where.field === "date")).toBe(true);
  });

  it("is zero for an empty period", async () => {
    await expect(sumPurchases(OCTOBER)).resolves.toEqual({
      totalCost: 0,
      count: 0,
      truncated: false,
    });
  });

  it("flags a period too large to total and sums only what it counted", async () => {
    for (let index = 0; index < PURCHASE_SUM_LIMIT + 1; index += 1) {
      seedPurchase(`p${index}`, new Date(Date.UTC(2026, 9, 2, 12, 0, index % 60) + index), 1);
    }

    const total = await sumPurchases(OCTOBER);

    expect(total?.truncated).toBe(true);
    expect(total?.count).toBe(PURCHASE_SUM_LIMIT);
    expect(total?.totalCost).toBe(PURCHASE_SUM_LIMIT);
  });

  it("ignores a corrupted (non-integer) totalCost instead of poisoning the sum", async () => {
    seedPurchase("good", new Date("2026-10-02T12:00:00Z"), 700);
    seedPurchase("bad", new Date("2026-10-03T12:00:00Z"), 0, { totalCost: 12.5 });

    await expect(sumPurchases(OCTOBER)).resolves.toMatchObject({ totalCost: 700, count: 2 });
  });

  it("returns null when Firebase is not configured", async () => {
    configured = false;

    await expect(sumPurchases(OCTOBER)).resolves.toBeNull();
  });
});
