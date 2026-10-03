import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUDIT_PATH,
  CASTING_PATH,
  FakeFirestore,
  FakeTimestamp,
  MATERIAL_PATH,
  MOVEMENT_PATH,
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

import { recordCasting, type RecordCastingInput } from "@/lib/admin/data/castings";
import { CastingInputError } from "@/lib/admin/domain/casting";
import { InventoryError } from "@/lib/admin/domain/inventory";

const ACTOR = "uid-admin-1";
const DATE = new Date("2026-10-02T06:00:00.000Z");

// The required vector: 5 g of wax in 14k yellow gold = 71.89 g of metal,
// weighed as 42.05 g of fine gold + 29.84 g of alloy.
const GOLD_14K: RecordCastingInput = {
  date: DATE,
  metal: "gold-14k",
  color: "yellow",
  waxGrams: 5,
  density: 13.07,
  fineness: 0.585,
  allowance: 0.1,
  recycledGrams: 0,
  fineMaterialId: "fine",
  alloyMaterialId: "alloy",
};

function seedMaterial(id: string, overrides: Record<string, unknown> = {}) {
  fake.seed(`materials/${id}`, {
    name: id,
    kind: "fine_gold",
    unit: "g",
    stock: 100,
    avgCost: 150_000,
    createdAt: new FakeTimestamp(new Date("2026-09-01T12:00:00Z")),
    updatedAt: new FakeTimestamp(new Date("2026-09-01T12:00:00Z")),
    ...overrides,
  });
}

function seedGoldShelf() {
  seedMaterial("fine", { name: "Oro fino", kind: "fine_gold", stock: 100, avgCost: 150_000 });
  seedMaterial("alloy", { name: "Liga 14k", kind: "alloy", stock: 50, avgCost: 8000 });
}

function dataOf(op: FakeOp | undefined): Record<string, unknown> {
  if (!op || op.kind === "delete") {
    throw new Error("expected a write operation");
  }
  return op.data;
}

async function failureOf(promise: Promise<unknown>): Promise<unknown> {
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

describe("recordCasting", () => {
  it("consumes the fine metal and the alloy and stores the casting", async () => {
    seedGoldShelf();

    const recorded = await recordCasting(GOLD_14K, ACTOR);

    expect(recorded).toEqual({ id: expect.any(String) });
    expect(fake.transactionsRun).toBe(1);

    // 100 - 42.05 and 50 - 29.84, exact to the hundredth. avgCost untouched.
    expect(fake.get("materials/fine")).toMatchObject({ stock: 57.95, avgCost: 150_000 });
    expect(fake.get("materials/alloy")).toMatchObject({ stock: 20.16, avgCost: 8000 });

    const casting = fake.get(`castings/${recorded?.id}`);
    expect(casting).toMatchObject({
      inputs: {
        metal: "gold-14k",
        color: "yellow",
        waxGrams: 5,
        density: 13.07,
        fineness: 0.585,
        allowance: 0.1,
        recycledGrams: 0,
      },
      outputs: { metalGrams: 71.89, fineGrams: 42.05, alloyGrams: 29.84, recycledGrams: 0 },
      consumed: [
        { materialId: "fine", qty: 42.05, unitCost: 150_000, totalCost: 6_307_500 },
        { materialId: "alloy", qty: 29.84, unitCost: 8000, totalCost: 238_720 },
      ],
      actor: ACTOR,
    });
    expect((casting?.date as FakeTimestamp).toDate()).toEqual(DATE);
    expect(dataOf(fake.opsMatching(CASTING_PATH, "create")[0]).createdAt).toBe(
      SERVER_TIMESTAMP,
    );
  });

  it("appends one NEGATIVE casting movement per material, tied to the casting", async () => {
    seedGoldShelf();

    const recorded = await recordCasting(GOLD_14K, ACTOR);

    const movements = fake.opsMatching(MOVEMENT_PATH, "create");
    expect(movements.map((op) => op.path.split("/")[1]).sort()).toEqual(["alloy", "fine"]);
    for (const op of movements) {
      const data = dataOf(op);
      expect(data).toMatchObject({
        type: "casting",
        refId: recorded?.id,
        createdAt: SERVER_TIMESTAMP,
        actor: ACTOR,
      });
      expect(data.qty as number).toBeLessThan(0);
    }
    const fineMovement = dataOf(movements.find((op) => op.path.includes("/fine/")));
    expect(fineMovement).toMatchObject({ qty: -42.05, unitCost: 150_000, totalCost: 6_307_500 });
  });

  it("only ever creates movements and never updates or deletes one", async () => {
    // Enough on the shelf for two castings (each draws 29.84 g of alloy).
    seedMaterial("fine", { kind: "fine_gold", stock: 200, avgCost: 150_000 });
    seedMaterial("alloy", { kind: "alloy", stock: 200, avgCost: 8000 });

    await recordCasting(GOLD_14K, ACTOR);
    await recordCasting(GOLD_14K, ACTOR);

    const movementOps = fake.opsMatching(MOVEMENT_PATH);
    expect(movementOps).toHaveLength(4);
    expect(movementOps.every((op) => op.kind === "create")).toBe(true);
    expect(new Set(movementOps.map((op) => op.path)).size).toBe(4);
  });

  it("writes an audit entry with no values", async () => {
    seedGoldShelf();

    const recorded = await recordCasting({ ...GOLD_14K, note: "Anillo secreto" }, ACTOR);

    const audit = fake.opsMatching(AUDIT_PATH, "create")[0];
    expect(dataOf(audit)).toEqual({
      actor: ACTOR,
      action: "casting.record",
      entity: "casting",
      entityId: recorded?.id,
      at: SERVER_TIMESTAMP,
    });
    expect(JSON.stringify(audit)).not.toContain("secreto");
  });

  it("RECOMPUTES the outputs from the raw inputs, ignoring any figures the caller sends", async () => {
    seedGoldShelf();

    const recorded = await recordCasting(
      {
        ...GOLD_14K,
        outputs: { metalGrams: 1, fineGrams: 1, alloyGrams: 1 },
      } as unknown as RecordCastingInput,
      ACTOR,
    );

    expect(fake.get(`castings/${recorded?.id}`)?.outputs).toMatchObject({
      fineGrams: 42.05,
      alloyGrams: 29.84,
    });
    expect(fake.get("materials/fine")).toMatchObject({ stock: 57.95 });
  });

  it("deducts recycled metal from what is consumed", async () => {
    seedGoldShelf();

    const recorded = await recordCasting({ ...GOLD_14K, recycledGrams: 20 }, ACTOR);

    // New metal = 71.885 - 20 = 51.885 -> fine 30.35, alloy 71.89 - 20 - 30.35 = 21.54
    expect(fake.get(`castings/${recorded?.id}`)?.outputs).toMatchObject({
      metalGrams: 71.89,
      fineGrams: 30.35,
      alloyGrams: 21.54,
      recycledGrams: 20,
    });
    expect(fake.get("materials/fine")).toMatchObject({ stock: 69.65 });
    expect(fake.get("materials/alloy")).toMatchObject({ stock: 28.46 });
  });

  it("omits the color for silver and the note when none is given", async () => {
    seedMaterial("fine-silver", { kind: "fine_silver", stock: 200, avgCost: 1500 });
    seedMaterial("copper", { kind: "alloy", stock: 50, avgCost: 400 });

    const recorded = await recordCasting(
      {
        date: DATE,
        metal: "silver-925",
        waxGrams: 5,
        density: 10.4,
        fineness: 0.925,
        allowance: 0.1,
        recycledGrams: 0,
        fineMaterialId: "fine-silver",
        alloyMaterialId: "copper",
      },
      ACTOR,
    );

    const casting = fake.get(`castings/${recorded?.id}`);
    expect(casting?.inputs).not.toHaveProperty("color");
    expect(casting).not.toHaveProperty("note");
  });
});

describe("recordCasting: stock and material checks", () => {
  it("rejects with a typed insufficient-stock error and writes NOTHING (fine short)", async () => {
    seedMaterial("fine", { kind: "fine_gold", stock: 40, avgCost: 150_000 });
    seedMaterial("alloy", { kind: "alloy", stock: 50, avgCost: 8000 });

    const error = await failureOf(recordCasting(GOLD_14K, ACTOR));

    expect(error).toBeInstanceOf(InventoryError);
    expect(error).toMatchObject({ code: "insufficient-stock" });
    expect(fake.committed).toHaveLength(0);
    expect(fake.get("materials/alloy")).toMatchObject({ stock: 50 });
  });

  it("rejects when the ALLOY is short, leaving the fine metal untouched", async () => {
    seedMaterial("fine", { kind: "fine_gold", stock: 100, avgCost: 150_000 });
    seedMaterial("alloy", { kind: "alloy", stock: 29.83, avgCost: 8000 });

    const error = await failureOf(recordCasting(GOLD_14K, ACTOR));

    expect(error).toMatchObject({ code: "insufficient-stock" });
    expect(fake.committed).toHaveLength(0);
    expect(fake.get("materials/fine")).toMatchObject({ stock: 100 });
  });

  it("allows using up a material exactly", async () => {
    seedMaterial("fine", { kind: "fine_gold", stock: 42.05, avgCost: 150_000 });
    seedMaterial("alloy", { kind: "alloy", stock: 29.84, avgCost: 8000 });

    await recordCasting(GOLD_14K, ACTOR);

    expect(fake.get("materials/fine")).toMatchObject({ stock: 0 });
    expect(fake.get("materials/alloy")).toMatchObject({ stock: 0 });
  });

  // Each case breaks exactly ONE thing about an otherwise valid shelf (the
  // kinds are spelled out so a case can't pass for a different reason).
  it.each([
    ["a gold pour drawing fine SILVER", { fine: { kind: "fine_silver", unit: "g" } }],
    ["an alloy pick that is not an alloy", { alloy: { kind: "fine_gold", unit: "g" } }],
    ["a fine pick measured in pieces", { fine: { kind: "fine_gold", unit: "pz" } }],
    ["an alloy pick measured in pieces", { alloy: { kind: "alloy", unit: "pz" } }],
  ])("refuses %s, writing nothing", async (_label, overrides) => {
    const { fine, alloy } = overrides as {
      fine?: Record<string, unknown>;
      alloy?: Record<string, unknown>;
    };
    seedMaterial("fine", {
      name: "Oro fino",
      kind: "fine_gold",
      stock: 100,
      avgCost: 150_000,
      ...fine,
    });
    seedMaterial("alloy", {
      name: "Liga 14k",
      kind: "alloy",
      stock: 50,
      avgCost: 8000,
      ...alloy,
    });

    const error = await failureOf(recordCasting(GOLD_14K, ACTOR));

    expect(error).toMatchObject({ code: "invalid-material" });
    expect(fake.committed).toHaveLength(0);
  });

  it("makes a silver pour draw fine silver, not fine gold", async () => {
    seedMaterial("fine", { kind: "fine_gold", stock: 100 });
    seedMaterial("alloy", { kind: "alloy", stock: 50 });

    const error = await failureOf(
      recordCasting(
        { ...GOLD_14K, metal: "silver-925", color: undefined, density: 10.4, fineness: 0.925 },
        ACTOR,
      ),
    );

    expect(error).toMatchObject({ code: "invalid-material" });
    expect(fake.committed).toHaveLength(0);
  });

  it("rejects an unknown material", async () => {
    seedMaterial("alloy", { kind: "alloy", stock: 50 });

    const error = await failureOf(recordCasting(GOLD_14K, ACTOR));

    expect(error).toMatchObject({ code: "material-not-found" });
    expect(fake.committed).toHaveLength(0);
  });

  it("refuses the same material for the fine metal and the alloy, without a transaction", async () => {
    seedGoldShelf();

    const error = await failureOf(
      recordCasting({ ...GOLD_14K, alloyMaterialId: "fine" }, ACTOR),
    );

    expect(error).toMatchObject({ code: "invalid-material" });
    expect(fake.transactionsRun).toBe(0);
  });

  it("refuses a missing or malformed pick for a part that weighs something", async () => {
    seedGoldShelf();

    for (const input of [
      { ...GOLD_14K, fineMaterialId: undefined },
      { ...GOLD_14K, alloyMaterialId: undefined },
      { ...GOLD_14K, fineMaterialId: "a/b/c" },
      { ...GOLD_14K, alloyMaterialId: "../secrets" },
    ]) {
      const error = await failureOf(recordCasting(input, ACTOR));
      expect(error).toMatchObject({ code: "invalid-material" });
    }
    expect(fake.transactionsRun).toBe(0);
  });
});

describe("recordCasting: parts that weigh nothing", () => {
  it("needs no alloy material when the fineness is 1", async () => {
    seedMaterial("fine", { kind: "fine_gold", stock: 100, avgCost: 150_000 });

    const recorded = await recordCasting(
      {
        ...GOLD_14K,
        density: 10,
        fineness: 1,
        allowance: 0,
        alloyMaterialId: undefined,
      },
      ACTOR,
    );

    // 5 g x 10 = 50 g, all of it fine; the alloy part is 0 g.
    expect(fake.get("materials/fine")).toMatchObject({ stock: 50 });
    expect(fake.get(`castings/${recorded?.id}`)?.consumed).toEqual([
      { materialId: "fine", qty: 50, unitCost: 150_000, totalCost: 7_500_000 },
    ]);
    expect(fake.opsMatching(MOVEMENT_PATH, "create")).toHaveLength(1);
  });

  it("registers a casting made entirely of recycled metal without touching any material", async () => {
    const recorded = await recordCasting(
      {
        ...GOLD_14K,
        density: 10,
        allowance: 0,
        recycledGrams: 50,
        fineMaterialId: undefined,
        alloyMaterialId: undefined,
      },
      ACTOR,
    );

    expect(fake.get(`castings/${recorded?.id}`)?.consumed).toEqual([]);
    expect(fake.opsMatching(MATERIAL_PATH)).toHaveLength(0);
    expect(fake.opsMatching(MOVEMENT_PATH)).toHaveLength(0);
  });
});

describe("recordCasting: input and configuration", () => {
  it.each([
    ["wax of zero", { waxGrams: 0 }, "waxGrams"],
    ["a negative density", { density: -1 }, "density"],
    ["a fineness above 1", { fineness: 1.5 }, "fineness"],
    ["recycled metal above the metal", { recycledGrams: 500 }, "recycledGrams"],
  ])("rejects %s with a CastingInputError before touching Firestore", async (_label, patch, field) => {
    seedGoldShelf();

    const error = await failureOf(recordCasting({ ...GOLD_14K, ...patch }, ACTOR));

    expect(error).toBeInstanceOf(CastingInputError);
    expect(error).toMatchObject({ field });
    expect(fake.transactionsRun).toBe(0);
  });

  it("returns null and writes nothing when Firebase is not configured", async () => {
    configured = false;

    await expect(recordCasting(GOLD_14K, ACTOR)).resolves.toBeNull();
  });
});
