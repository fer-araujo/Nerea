import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUDIT_PATH,
  FakeFirestore,
  FakeTimestamp,
  FakeTransaction,
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
  PIECES_LIMIT,
  listPieces,
  readPieceCostTotals,
  savePieceCost,
  toPieceRecord,
  type SavePieceCostInput,
} from "@/lib/admin/data/pieces";
import { InventoryError } from "@/lib/admin/domain/inventory";
import { SalesError } from "@/lib/admin/domain/sales";

const ACTOR = "uid-admin-1";
const PIECE_PATH = /^pieces\/[^/]+$/;

const BASE: SavePieceCostInput = {
  handle: "anillo-luna",
  costs: { metal: 120_000, stones: 30_000, other: 5_000, labor: 45_000 },
};

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
  fake = new FakeFirestore();
  configured = true;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("savePieceCost", () => {
  it("writes pieces/{handle} with exactly the documented fields", async () => {
    const saved = await savePieceCost(
      {
        ...BASE,
        metalGrams: 12.5,
        materialId: "silver",
        note: "Piedra de la clienta",
      },
      ACTOR,
    );

    expect(saved).toEqual({ handle: "anillo-luna" });
    expect(fake.transactionsRun).toBe(1);
    expect(dataOf(fake.opsMatching(PIECE_PATH, "set")[0])).toEqual({
      handle: "anillo-luna",
      costs: { metal: 120_000, stones: 30_000, other: 5_000, labor: 45_000 },
      metalGrams: 12.5,
      materialId: "silver",
      note: "Piedra de la clienta",
      updatedAt: SERVER_TIMESTAMP,
      actor: ACTOR,
    });
  });

  it("omits what it was not given instead of storing undefined (labor is optional)", async () => {
    await savePieceCost(
      { handle: "aretes-sol", costs: { metal: 1000, stones: 0, other: 0 } },
      ACTOR,
    );

    const stored = fake.get("pieces/aretes-sol");
    expect(stored?.costs).toEqual({ metal: 1000, stones: 0, other: 0 });
    for (const field of ["metalGrams", "materialId", "note"]) {
      expect(stored).not.toHaveProperty(field);
    }
  });

  it("replaces the whole document, so a cleared note or labor really goes away", async () => {
    await savePieceCost({ ...BASE, note: "Primera versión" }, ACTOR);

    await savePieceCost(
      { handle: "anillo-luna", costs: { metal: 100_000, stones: 0, other: 0 } },
      ACTOR,
    );

    const stored = fake.get("pieces/anillo-luna");
    expect(stored?.costs).toEqual({ metal: 100_000, stones: 0, other: 0 });
    expect(stored).not.toHaveProperty("note");
  });

  it("keeps a recorded cost of ZERO distinct from no document at all", async () => {
    await savePieceCost(
      { handle: "regalo", costs: { metal: 0, stones: 0, other: 0 } },
      ACTOR,
    );

    expect(fake.get("pieces/regalo")).toBeDefined();
    expect(fake.get("pieces/no-registrada")).toBeUndefined();
  });

  it("stamps the time with a server timestamp, never the client's clock", async () => {
    await savePieceCost(BASE, ACTOR);

    expect(dataOf(fake.opsMatching(PIECE_PATH, "set")[0]).updatedAt).toBe(
      SERVER_TIMESTAMP,
    );
  });

  it("audits who changed WHICH piece, in the same transaction, and never the values", async () => {
    await savePieceCost({ ...BASE, note: "Nota privada" }, ACTOR);

    const audit = fake.opsMatching(AUDIT_PATH, "create");
    expect(audit).toHaveLength(1);
    expect(dataOf(audit[0])).toEqual({
      actor: ACTOR,
      action: "piece.update",
      entity: "piece",
      entityId: "anillo-luna",
      at: SERVER_TIMESTAMP,
    });
    expect(JSON.stringify(audit)).not.toContain("120000");
    expect(JSON.stringify(audit)).not.toContain("privada");
    expect(fake.transactionsRun).toBe(1);
  });

  it("refuses a handle that cannot be a document id, before opening a transaction", async () => {
    for (const handle of ["a/b", "", "../x", "has space", "__reserved__", "a".repeat(129)]) {
      const error = await errorOf(savePieceCost({ ...BASE, handle }, ACTOR));

      expect(error).toBeInstanceOf(SalesError);
      expect((error as SalesError).code).toBe("piece-not-found");
    }
    expect(fake.transactionsRun).toBe(0);
  });

  it.each([
    ["a fractional cost", { metal: 10.5, stones: 0, other: 0 }],
    ["a negative cost", { metal: 0, stones: -1, other: 0 }],
    ["a fractional labor", { metal: 0, stones: 0, other: 0, labor: 0.5 }],
    ["NaN", { metal: Number.NaN, stones: 0, other: 0 }],
  ])("refuses %s as an invalid cost", async (_label, costs) => {
    const error = await errorOf(savePieceCost({ handle: "anillo-luna", costs }, ACTOR));

    expect(error).toBeInstanceOf(InventoryError);
    expect((error as InventoryError).code).toBe("invalid-cost");
    expect(fake.transactionsRun).toBe(0);
  });

  it("refuses grams that are not a positive number and a material id that is not an id", async () => {
    const grams = await errorOf(savePieceCost({ ...BASE, metalGrams: 0 }, ACTOR));
    const material = await errorOf(
      savePieceCost({ ...BASE, materialId: "a/b" }, ACTOR),
    );

    expect((grams as InventoryError).code).toBe("invalid-quantity");
    expect((material as InventoryError).code).toBe("material-not-found");
    expect(fake.transactionsRun).toBe(0);
  });

  it("returns null and writes nothing when Firebase is not configured", async () => {
    configured = false;

    await expect(savePieceCost(BASE, ACTOR)).resolves.toBeNull();
    expect(fake.committed).toHaveLength(0);
  });
});

describe("toPieceRecord and listPieces", () => {
  it("lists every piece that has a cost, keyed by its document id", async () => {
    fake.seed("pieces/anillo-luna", {
      handle: "anillo-luna",
      costs: { metal: 120_000, stones: 30_000, other: 5_000, labor: 45_000 },
      metalGrams: 12.5,
      materialId: "silver",
      note: "Nota",
      updatedAt: new FakeTimestamp(new Date("2026-10-02T12:00:00Z")),
      actor: ACTOR,
    });

    const pieces = await listPieces();

    expect(pieces).toEqual([
      {
        handle: "anillo-luna",
        costs: { metal: 120_000, stones: 30_000, other: 5_000, labor: 45_000 },
        metalGrams: 12.5,
        materialId: "silver",
        note: "Nota",
        updatedAt: new Date("2026-10-02T12:00:00Z"),
      },
    ]);
    expect(fake.queries[0]).toMatchObject({
      collection: "pieces",
      limit: PIECES_LIMIT,
      wheres: [],
      orderBys: [],
    });
  });

  it("trusts the document id over a hand-edited handle field", async () => {
    fake.seed("pieces/real", { handle: "fake", costs: { metal: 1, stones: 0, other: 0 } });

    const [piece] = (await listPieces()) ?? [];

    expect(piece.handle).toBe("real");
  });

  it("coerces a hand-edited document instead of throwing", async () => {
    fake.seed("pieces/odd", {
      // Anything that isn't whole non-negative centavos reads as 0. A labor
      // that is a number (even a broken one) stays "recorded, as 0"; one that
      // isn't a number at all is simply not there.
      costs: { metal: "lots", stones: 12.5, other: -3, labor: -2 },
      metalGrams: -4,
      materialId: 7,
      note: { text: "no" },
      updatedAt: "yesterday",
    });
    fake.seed("pieces/text-labor", { costs: { metal: 5, stones: 0, other: 0, labor: "x" } });
    fake.seed("pieces/no-costs", { costs: "none" });
    fake.seed("pieces/empty", {});

    const pieces = await listPieces();

    expect(pieces).toEqual([
      {
        handle: "odd",
        costs: { metal: 0, stones: 0, other: 0, labor: 0 },
        metalGrams: null,
        materialId: null,
        note: null,
        updatedAt: null,
      },
      expect.objectContaining({ handle: "text-labor", costs: { metal: 5, stones: 0, other: 0 } }),
      expect.objectContaining({ handle: "no-costs", costs: { metal: 0, stones: 0, other: 0 } }),
      expect.objectContaining({ handle: "empty", costs: { metal: 0, stones: 0, other: 0 } }),
    ]);
  });

  it("reads a snapshot's costs straight from the document", () => {
    fake.seed("pieces/a", { costs: { metal: 7, stones: 1, other: 2 } });

    const record = toPieceRecord(fake.snapshot(fake.collection("pieces").doc("a")) as never);

    expect(record.costs).toEqual({ metal: 7, stones: 1, other: 2 });
  });

  it("returns null when Firebase is not configured", async () => {
    configured = false;

    await expect(listPieces()).resolves.toBeNull();
  });
});

describe("readPieceCostTotals", () => {
  it("returns the total cost of each handle that has one, inside the caller's transaction", async () => {
    fake.seed("pieces/a", { costs: { metal: 100, stones: 20, other: 3, labor: 4 } });
    fake.seed("pieces/b", { costs: { metal: 0, stones: 0, other: 0 } });

    const totals = await fake.runTransaction((tx) =>
      readPieceCostTotals(fake as never, tx as never, ["a", "b", "c"]),
    );

    // "b" is a recorded zero; "c" has no document and is simply absent.
    expect(totals).toEqual(
      new Map([
        ["a", 127],
        ["b", 0],
      ]),
    );
  });

  it("reads every handle once and skips handles that cannot be ids", async () => {
    fake.seed("pieces/a", { costs: { metal: 1, stones: 0, other: 0 } });
    const getAll = vi.spyOn(FakeTransaction.prototype, "getAll");

    await fake.runTransaction((tx) =>
      readPieceCostTotals(fake as never, tx as never, ["a", "a", "x/y", "__no__", "../z"]),
    );

    expect(getAll).toHaveBeenCalledTimes(1);
    expect(getAll.mock.calls[0].map((ref) => ref.path)).toEqual(["pieces/a"]);
  });

  it("asks for nothing when there is nothing valid to ask for (getAll needs a document)", async () => {
    await expect(
      fake.runTransaction((tx) => readPieceCostTotals(fake as never, tx as never, [])),
    ).resolves.toEqual(new Map());
    await expect(
      fake.runTransaction((tx) => readPieceCostTotals(fake as never, tx as never, ["a/b"])),
    ).resolves.toEqual(new Map());
  });
});
