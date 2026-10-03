import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUDIT_PATH,
  FakeFirestore,
  FakeTimestamp,
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

// The catalog (Sanity) is mocked at its own module: this file covers what the
// sales ledger does with the answer. Its queries are in admin-catalog-data.
const getCatalogProductsMock = vi.fn();
vi.mock("@/lib/admin/data/catalog", () => ({
  getCatalogProducts: (...args: unknown[]) => getCatalogProductsMock(...args),
}));

import {
  SALES_PAGE_SIZE,
  SALES_SUM_LIMIT,
  listSales,
  recordManualSale,
  sumSales,
  voidSale,
  type RecordManualSaleInput,
} from "@/lib/admin/data/sales";
import { InventoryError } from "@/lib/admin/domain/inventory";
import { periodRange } from "@/lib/admin/domain/periods";
import { MAX_SALE_ITEMS, SalesError } from "@/lib/admin/domain/sales";

const ACTOR = "uid-admin-1";
const DATE = new Date("2026-10-01T06:00:00.000Z");
const SALE_PATH = /^sales\/[^/]+$/;

interface CatalogEntry {
  handle: string;
  title?: string;
  price?: number;
  availability?: "available" | "sold";
}

function stockCatalog(...entries: CatalogEntry[]) {
  getCatalogProductsMock.mockImplementation(async (handles: string[]) => {
    const found = new Map<string, unknown>();
    for (const entry of entries) {
      if (handles.includes(entry.handle)) {
        found.set(entry.handle, {
          title: entry.handle,
          price: 100_000,
          availability: "available",
          categoryTitle: null,
          ...entry,
        });
      }
    }
    return found;
  });
}

function seedCost(handle: string, costs = { metal: 40_000, stones: 15_000, other: 5_000 }) {
  fake.seed(`pieces/${handle}`, { handle, costs });
}

function input(overrides: Partial<RecordManualSaleInput> = {}): RecordManualSaleInput {
  return {
    date: DATE,
    items: [{ handle: "anillo-luna", price: 185_000 }],
    shipping: 0,
    ...overrides,
  };
}

function dataOf(op: FakeOp | undefined): Record<string, unknown> {
  if (!op || op.kind === "delete") {
    throw new Error("expected a write operation");
  }
  return op.data;
}

async function errorOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  return undefined;
}

beforeEach(() => {
  vi.resetAllMocks();
  fake = new FakeFirestore();
  configured = true;
  stockCatalog(
    { handle: "anillo-luna", title: "Anillo Luna", price: 185_000 },
    { handle: "aretes-sol", title: "Aretes Sol", price: 90_000 },
  );
});

describe("recordManualSale", () => {
  it("writes the sale with its frozen cost, catalog titles and the audit trail", async () => {
    seedCost("anillo-luna"); // 60_000 in total

    const recorded = await recordManualSale(
      input({
        items: [{ handle: "anillo-luna", price: 185_000, option: "Talla 7" }],
        shipping: 15_000,
        note: "Entrega en persona",
      }),
      ACTOR,
    );

    // The lines as recorded come back with the id (the action names a piece by
    // its title if it later fails to mark it sold).
    expect(recorded).toEqual({
      id: expect.any(String),
      items: [
        { handle: "anillo-luna", title: "Anillo Luna", price: 185_000, option: "Talla 7" },
      ],
    });
    expect(fake.transactionsRun).toBe(1);

    const stored = fake.get(`sales/${recorded?.id}`);
    expect(stored).toEqual({
      source: "manual",
      status: "active",
      date: expect.any(FakeTimestamp),
      items: [
        { handle: "anillo-luna", title: "Anillo Luna", price: 185_000, option: "Talla 7" },
      ],
      subtotal: 185_000,
      shipping: 15_000,
      total: 200_000,
      currency: "MXN",
      costOfGoods: 60_000,
      costPending: false,
      note: "Entrega en persona",
      createdAt: expect.any(FakeTimestamp),
      actor: ACTOR,
    });
    expect((stored?.date as FakeTimestamp).toDate()).toEqual(DATE);

    const audit = fake.opsMatching(AUDIT_PATH, "create")[0];
    expect(dataOf(audit)).toEqual({
      actor: ACTOR,
      action: "sale.record",
      entity: "sale",
      entityId: recorded?.id,
      at: SERVER_TIMESTAMP,
    });
    expect(JSON.stringify(audit)).not.toContain("185000");
    expect(JSON.stringify(audit)).not.toContain("entrega");
  });

  it("freezes the cost at the moment of the sale: a later cost change does not touch it", async () => {
    seedCost("anillo-luna");

    const recorded = await recordManualSale(input(), ACTOR);
    seedCost("anillo-luna", { metal: 999_000, stones: 0, other: 0 });

    expect(fake.get(`sales/${recorded?.id}`)).toMatchObject({
      costOfGoods: 60_000,
      costPending: false,
    });
  });

  it("marks the sale 'costo pendiente' when a piece has no cost, counting the ones that do", async () => {
    seedCost("anillo-luna");

    const recorded = await recordManualSale(
      input({
        items: [
          { handle: "anillo-luna", price: 185_000 },
          { handle: "aretes-sol", price: 90_000 },
        ],
      }),
      ACTOR,
    );

    expect(fake.get(`sales/${recorded?.id}`)).toMatchObject({
      subtotal: 275_000,
      total: 275_000,
      costOfGoods: 60_000,
      costPending: true,
    });
  });

  it("is pending (not free) when no piece has a cost recorded at all", async () => {
    const recorded = await recordManualSale(input(), ACTOR);

    expect(fake.get(`sales/${recorded?.id}`)).toMatchObject({
      costOfGoods: 0,
      costPending: true,
    });
  });

  it("treats a recorded cost of ZERO as settled, not pending", async () => {
    seedCost("anillo-luna", { metal: 0, stones: 0, other: 0 });

    const recorded = await recordManualSale(input(), ACTOR);

    expect(fake.get(`sales/${recorded?.id}`)).toMatchObject({
      costOfGoods: 0,
      costPending: false,
    });
  });

  it("stores the price as typed, so a discount below the catalog price is kept", async () => {
    const recorded = await recordManualSale(
      input({ items: [{ handle: "anillo-luna", price: 150_000 }] }),
      ACTOR,
    );

    expect(fake.get(`sales/${recorded?.id}`)).toMatchObject({
      items: [{ handle: "anillo-luna", title: "Anillo Luna", price: 150_000 }],
      subtotal: 150_000,
    });
  });

  it("takes titles from the catalog, never from the caller", async () => {
    const recorded = await recordManualSale(
      input({
        items: [{ handle: "anillo-luna", price: 1, title: "Hacked" } as never],
      }),
      ACTOR,
    );

    const stored = fake.get(`sales/${recorded?.id}`);
    expect(JSON.stringify(stored)).not.toContain("Hacked");
    expect(stored?.items).toEqual([{ handle: "anillo-luna", title: "Anillo Luna", price: 1 }]);
  });

  it("falls back to the handle when the catalog piece has no title", async () => {
    stockCatalog({ handle: "sin-titulo", title: "" });

    const recorded = await recordManualSale(
      input({ items: [{ handle: "sin-titulo", price: 100 }] }),
      ACTOR,
    );

    expect(fake.get(`sales/${recorded?.id}`)?.items).toEqual([
      { handle: "sin-titulo", title: "sin-titulo", price: 100 },
    ]);
  });

  it("omits the option, the note and the shipping it was not given instead of storing undefined", async () => {
    const recorded = await recordManualSale(input(), ACTOR);

    const stored = fake.get(`sales/${recorded?.id}`);
    expect(stored).not.toHaveProperty("note");
    expect(stored).not.toHaveProperty("stripeSessionId");
    expect((stored?.items as Array<Record<string, unknown>>)[0]).not.toHaveProperty("option");
    expect(stored).toMatchObject({ shipping: 0, total: 185_000 });
  });

  it("stamps createdAt with a server timestamp, never the client's clock", async () => {
    await recordManualSale(input(), ACTOR);

    expect(dataOf(fake.opsMatching(SALE_PATH, "create")[0]).createdAt).toBe(SERVER_TIMESTAMP);
  });

  it("has NO place for customer data: only the documented fields are ever stored", async () => {
    seedCost("anillo-luna");

    const recorded = await recordManualSale(
      {
        ...input({ note: "Venta en feria" }),
        // A caller trying to smuggle customer data in must not be able to.
        customerEmail: "ana@example.com",
        customerName: "Ana Pérez",
        phone: "+525512345678",
        address: "Calle 1",
      } as never,
      ACTOR,
    );

    const stored = fake.get(`sales/${recorded?.id}`) ?? {};
    expect(Object.keys(stored).sort()).toEqual(
      [
        "actor",
        "costOfGoods",
        "costPending",
        "createdAt",
        "currency",
        "date",
        "items",
        "note",
        "shipping",
        "source",
        "status",
        "subtotal",
        "total",
      ].sort(),
    );
    expect(JSON.stringify(stored)).not.toMatch(/ana@example|Pérez|5512345678|Calle 1/);
  });
});

describe("recordManualSale: refusals write nothing", () => {
  it("refuses a piece the catalog does not know", async () => {
    const error = await errorOf(
      recordManualSale(input({ items: [{ handle: "fantasma", price: 100 }] }), ACTOR),
    );

    expect(error).toBeInstanceOf(SalesError);
    expect((error as SalesError).code).toBe("piece-not-found");
    expect(fake.committed).toHaveLength(0);
  });

  it("refuses a piece that is already sold, however the request got there", async () => {
    stockCatalog({ handle: "anillo-luna", availability: "sold" });

    const error = await errorOf(recordManualSale(input(), ACTOR));

    expect((error as SalesError).code).toBe("piece-unavailable");
    expect(fake.committed).toHaveLength(0);
  });

  it("refuses the WHOLE sale when only one of its pieces is unavailable", async () => {
    stockCatalog(
      { handle: "anillo-luna" },
      { handle: "aretes-sol", availability: "sold" },
    );

    const error = await errorOf(
      recordManualSale(
        input({
          items: [
            { handle: "anillo-luna", price: 100 },
            { handle: "aretes-sol", price: 100 },
          ],
        }),
        ACTOR,
      ),
    );

    expect((error as SalesError).code).toBe("piece-unavailable");
    expect(fake.committed).toHaveLength(0);
  });

  it("refuses a piece repeated in one sale (a one-of-one piece sells once)", async () => {
    const error = await errorOf(
      recordManualSale(
        input({
          items: [
            { handle: "anillo-luna", price: 100 },
            { handle: "anillo-luna", price: 100 },
          ],
        }),
        ACTOR,
      ),
    );

    expect((error as SalesError).code).toBe("invalid-sale");
    expect(getCatalogProductsMock).not.toHaveBeenCalled();
    expect(fake.transactionsRun).toBe(0);
  });

  it("refuses an empty sale and one with too many pieces, before any read", async () => {
    const empty = await errorOf(recordManualSale(input({ items: [] }), ACTOR));
    const tooMany = await errorOf(
      recordManualSale(
        input({
          items: Array.from({ length: MAX_SALE_ITEMS + 1 }, (_, index) => ({
            handle: `pieza-${index}`,
            price: 100,
          })),
        }),
        ACTOR,
      ),
    );

    expect((empty as SalesError).code).toBe("invalid-sale");
    expect((tooMany as SalesError).code).toBe("invalid-sale");
    expect(getCatalogProductsMock).not.toHaveBeenCalled();
    expect(fake.transactionsRun).toBe(0);
  });

  it("refuses a handle that could address another path, before any read", async () => {
    const error = await errorOf(
      recordManualSale(input({ items: [{ handle: "a/b/c", price: 100 }] }), ACTOR),
    );

    expect((error as SalesError).code).toBe("piece-not-found");
    expect(getCatalogProductsMock).not.toHaveBeenCalled();
    expect(fake.transactionsRun).toBe(0);
  });

  it.each([
    ["a fractional price", { items: [{ handle: "anillo-luna", price: 10.5 }] }],
    ["a negative price", { items: [{ handle: "anillo-luna", price: -1 }] }],
    ["a fractional shipping", { shipping: 0.5 }],
    ["a negative shipping", { shipping: -100 }],
  ])("refuses %s as an invalid cost", async (_label, patch) => {
    const error = await errorOf(recordManualSale(input(patch), ACTOR));

    expect(error).toBeInstanceOf(InventoryError);
    expect((error as InventoryError).code).toBe("invalid-cost");
    expect(getCatalogProductsMock).not.toHaveBeenCalled();
    expect(fake.transactionsRun).toBe(0);
  });

  it("returns null without even asking the catalog when Firebase is not configured", async () => {
    configured = false;

    await expect(recordManualSale(input(), ACTOR)).resolves.toBeNull();
    expect(getCatalogProductsMock).not.toHaveBeenCalled();
  });

  it("rejects when the catalog cannot be read, and writes nothing", async () => {
    getCatalogProductsMock.mockRejectedValue(new Error("network down"));

    await expect(recordManualSale(input(), ACTOR)).rejects.toThrow("network down");
    expect(fake.committed).toHaveLength(0);
  });

  it("writes neither the sale nor the audit entry when the transaction fails", async () => {
    vi.spyOn(fake, "runTransaction").mockRejectedValue(new Error("aborted"));

    await expect(recordManualSale(input(), ACTOR)).rejects.toThrow("aborted");
    expect(fake.committed).toHaveLength(0);
  });
});

function seedSale(id: string, overrides: Record<string, unknown> = {}) {
  fake.seed(`sales/${id}`, {
    source: "manual",
    status: "active",
    date: new FakeTimestamp(new Date("2026-10-05T18:00:00Z")),
    items: [{ handle: "anillo-luna", title: "Anillo Luna", price: 185_000 }],
    subtotal: 185_000,
    shipping: 0,
    total: 185_000,
    currency: "MXN",
    costOfGoods: 60_000,
    costPending: false,
    createdAt: new FakeTimestamp(new Date("2026-10-05T18:00:00Z")),
    actor: ACTOR,
    ...overrides,
  });
}

describe("voidSale", () => {
  it("marks a manual sale void, keeps it on record and audits it with no values", async () => {
    seedSale("s1", { note: "Nota privada" });

    await expect(voidSale("s1", ACTOR)).resolves.toEqual({ voided: true });

    expect(fake.get("sales/s1")).toMatchObject({
      status: "void",
      // Everything else is exactly as it was: nothing is deleted or rewritten.
      subtotal: 185_000,
      costOfGoods: 60_000,
      note: "Nota privada",
    });
    expect(fake.opsMatching(SALE_PATH, "delete")).toHaveLength(0);

    const audit = fake.opsMatching(AUDIT_PATH, "create");
    expect(audit).toHaveLength(1);
    expect(dataOf(audit[0])).toEqual({
      actor: ACTOR,
      action: "sale.void",
      entity: "sale",
      entityId: "s1",
      at: SERVER_TIMESTAMP,
    });
    expect(JSON.stringify(audit)).not.toContain("privada");
  });

  it("refuses a Stripe sale: the payment is refunded in Stripe, not voided here", async () => {
    seedSale("stripe_cs_test_1", { source: "stripe" });

    const error = await errorOf(voidSale("stripe_cs_test_1", ACTOR));

    expect((error as SalesError).code).toBe("sale-not-voidable");
    expect(fake.committed).toHaveLength(0);
    expect(fake.get("sales/stripe_cs_test_1")).toMatchObject({ status: "active" });
  });

  it("does not assume a document with an unreadable source is manual", async () => {
    seedSale("odd", { source: "carrier-pigeon" });

    const error = await errorOf(voidSale("odd", ACTOR));

    expect((error as SalesError).code).toBe("sale-not-voidable");
    expect(fake.committed).toHaveLength(0);
  });

  it("succeeds without writing or auditing again when the sale is already void", async () => {
    seedSale("s1", { status: "void" });

    await expect(voidSale("s1", ACTOR)).resolves.toEqual({ voided: false });

    expect(fake.committed).toHaveLength(0);
  });

  it("refuses a sale that does not exist", async () => {
    const error = await errorOf(voidSale("ghost", ACTOR));

    expect((error as SalesError).code).toBe("sale-not-found");
    expect(fake.committed).toHaveLength(0);
  });

  it("refuses a malformed id without opening a transaction", async () => {
    for (const id of ["a/b", "", "../x", "x".repeat(129)]) {
      const error = await errorOf(voidSale(id, ACTOR));

      expect((error as SalesError).code).toBe("sale-not-found");
    }
    expect(fake.transactionsRun).toBe(0);
  });

  it("returns null when Firebase is not configured", async () => {
    configured = false;

    await expect(voidSale("s1", ACTOR)).resolves.toBeNull();
  });
});

describe("listSales", () => {
  const OCTOBER = periodRange("this-month", new Date("2026-10-15T12:00:00Z"));

  it("filters by a half-open date range and orders by that same single field", async () => {
    seedSale("before", { date: new FakeTimestamp(new Date("2026-10-01T05:59:59.999Z")) });
    seedSale("first-instant", { date: new FakeTimestamp(new Date("2026-10-01T06:00:00.000Z")) });
    seedSale("middle", { date: new FakeTimestamp(new Date("2026-10-15T18:00:00.000Z")) });
    seedSale("at-end", { date: new FakeTimestamp(new Date("2026-11-01T06:00:00.000Z")) });

    const page = await listSales(OCTOBER);

    expect(page?.sales.map((sale) => sale.id)).toEqual(["middle", "first-instant"]);
    expect(fake.queries[0]).toMatchObject({
      collection: "sales",
      orderBys: [{ field: "date", direction: "desc" }],
      offset: 0,
      limit: SALES_PAGE_SIZE + 1,
    });
    expect(fake.queries[0].wheres.map((where) => [where.field, where.op])).toEqual([
      ["date", ">="],
      ["date", "<"],
    ]);
  });

  it("keeps voided sales on the list (the page shows them muted)", async () => {
    seedSale("kept");
    seedSale("voided", { status: "void" });

    const page = await listSales(OCTOBER);

    expect(page?.sales.map((sale) => [sale.id, sale.status])).toEqual([
      ["kept", "active"],
      ["voided", "void"],
    ]);
  });

  it("cuts pages and reports a next page via the extra document", async () => {
    for (let index = 1; index <= SALES_PAGE_SIZE + 1; index += 1) {
      seedSale(`s${String(index).padStart(3, "0")}`, {
        date: new FakeTimestamp(new Date(Date.UTC(2026, 9, 2, 12, index))),
      });
    }

    const first = await listSales(OCTOBER, 1);
    const second = await listSales(OCTOBER, 2);

    expect(first?.sales).toHaveLength(SALES_PAGE_SIZE);
    expect(first?.hasNextPage).toBe(true);
    expect(second?.sales).toHaveLength(1);
    expect(second?.hasNextPage).toBe(false);
  });

  it("maps a sale and coerces hand-edited documents", async () => {
    seedSale("ok", {
      source: "stripe",
      items: [{ handle: "anillo-luna", title: "Anillo Luna", price: 185_000, option: "Talla 7" }],
      shipping: 15_000,
      total: 200_000,
      costPending: true,
      note: "Hola",
    });
    seedSale("odd", {
      date: new FakeTimestamp(new Date("2026-10-04T18:00:00Z")),
      source: "fax",
      status: "maybe",
      items: ["junk", { handle: 5, title: null, price: 1.5 }, null],
      subtotal: "lots",
      shipping: -1,
      total: 12.5,
      costOfGoods: Number.NaN,
      costPending: "yes",
    });

    const page = await listSales(OCTOBER);

    expect(page?.sales[0]).toEqual({
      id: "ok",
      source: "stripe",
      status: "active",
      date: new Date("2026-10-05T18:00:00Z"),
      items: [{ handle: "anillo-luna", title: "Anillo Luna", price: 185_000, option: "Talla 7" }],
      subtotal: 185_000,
      shipping: 15_000,
      total: 200_000,
      costOfGoods: 60_000,
      costPending: true,
      note: "Hola",
    });
    expect(page?.sales[1]).toEqual({
      id: "odd",
      source: "manual",
      status: "active",
      date: new Date("2026-10-04T18:00:00Z"),
      items: [{ handle: "", title: "", price: 0 }],
      subtotal: 0,
      shipping: 0,
      total: 0,
      costOfGoods: 0,
      costPending: false,
      note: null,
    });
  });

  it.each([0, -1, 1.5, Number.NaN, 201, 1e9])(
    "falls back to the first page for the out-of-range page %s",
    async (page) => {
      await listSales(OCTOBER, page);

      expect(fake.queries[0].offset).toBe(0);
    },
  );

  it("returns null when Firebase is not configured", async () => {
    configured = false;

    await expect(listSales(OCTOBER)).resolves.toBeNull();
  });
});

describe("sumSales (period totals)", () => {
  const OCTOBER = periodRange("this-month", new Date("2026-10-15T12:00:00Z"));

  it("totals EVERY sale of the period, not just a page", async () => {
    for (let index = 1; index <= SALES_PAGE_SIZE + 5; index += 1) {
      seedSale(`s${index}`, {
        date: new FakeTimestamp(new Date(Date.UTC(2026, 9, 2, 12, index))),
        subtotal: 1000,
        shipping: 100,
        total: 1100,
        costOfGoods: 400,
      });
    }
    seedSale("september", {
      date: new FakeTimestamp(new Date("2026-09-20T12:00:00Z")),
      subtotal: 99_999,
    });
    const count = SALES_PAGE_SIZE + 5;

    const total = await sumSales(OCTOBER);

    expect(total).toEqual({
      count,
      voidedCount: 0,
      subtotal: count * 1000,
      shipping: count * 100,
      total: count * 1100,
      costOfGoods: count * 400,
      grossProfit: count * 600,
      pendingCount: 0,
      truncated: false,
    });
  });

  it("leaves a voided sale out of every figure", async () => {
    seedSale("kept", { subtotal: 100_000, total: 100_000, costOfGoods: 40_000 });
    seedSale("voided", {
      status: "void",
      subtotal: 777_000,
      total: 777_000,
      costOfGoods: 111_000,
      costPending: true,
    });

    await expect(sumSales(OCTOBER)).resolves.toMatchObject({
      count: 1,
      voidedCount: 1,
      subtotal: 100_000,
      costOfGoods: 40_000,
      grossProfit: 60_000,
      pendingCount: 0,
    });
  });

  it("counts the sales with a pending cost, so the page can warn", async () => {
    seedSale("a", { costPending: true, costOfGoods: 0 });
    seedSale("b");

    await expect(sumSales(OCTOBER)).resolves.toMatchObject({ count: 2, pendingCount: 1 });
  });

  it("reads only the fields the totals need, with a range on date alone (no composite index)", async () => {
    seedSale("s1", { note: "No me leas" });

    await sumSales(OCTOBER);

    expect(fake.queries[0]).toMatchObject({
      collection: "sales",
      select: ["status", "subtotal", "shipping", "total", "costOfGoods", "costPending"],
      orderBys: [],
    });
    // Filtering by status as well would need a composite index.
    expect(fake.queries[0].wheres.every((where) => where.field === "date")).toBe(true);
  });

  it("is zero for an empty period", async () => {
    await expect(sumSales(OCTOBER)).resolves.toEqual({
      count: 0,
      voidedCount: 0,
      subtotal: 0,
      shipping: 0,
      total: 0,
      costOfGoods: 0,
      grossProfit: 0,
      pendingCount: 0,
      truncated: false,
    });
  });

  it("flags a period too large to total and sums only what it counted", async () => {
    for (let index = 0; index < SALES_SUM_LIMIT + 1; index += 1) {
      seedSale(`s${index}`, {
        date: new FakeTimestamp(new Date(Date.UTC(2026, 9, 2, 12, 0, index % 60) + index)),
        subtotal: 1,
        total: 1,
        costOfGoods: 0,
      });
    }

    const total = await sumSales(OCTOBER);

    expect(total?.truncated).toBe(true);
    expect(total?.count).toBe(SALES_SUM_LIMIT);
    expect(total?.subtotal).toBe(SALES_SUM_LIMIT);
  });

  it("ignores a corrupted (non-integer) amount instead of poisoning the sum", async () => {
    seedSale("good", { subtotal: 700, total: 700, costOfGoods: 0 });
    seedSale("bad", { subtotal: 12.5, total: "x", costOfGoods: 0 });

    await expect(sumSales(OCTOBER)).resolves.toMatchObject({ subtotal: 700, count: 2 });
  });

  it("returns null when Firebase is not configured", async () => {
    configured = false;

    await expect(sumSales(OCTOBER)).resolves.toBeNull();
  });
});
