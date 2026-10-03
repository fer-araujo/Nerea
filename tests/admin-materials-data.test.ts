import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUDIT_PATH,
  FakeFirestore,
  FakeTimestamp,
  MATERIAL_PATH,
  MOVEMENT_PATH,
  SERVER_TIMESTAMP,
} from "@/tests/helpers/fake-firestore";

// Firestore is replaced by an in-memory fake (tests/helpers/fake-firestore.ts)
// that enforces the rules the data layer promises: reads before writes, atomic
// commit, `create` never overwriting, and no query that needs a composite
// index. So a green test here means the rule held, not that a mock was called.
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
  MATERIALS_LIMIT,
  MOVEMENTS_PAGE_SIZE,
  adjustStock,
  createMaterial,
  listMaterials,
  listMovements,
} from "@/lib/admin/data/materials";
import { InventoryError } from "@/lib/admin/domain/inventory";

const ACTOR = "uid-admin-1";

function seedMaterial(id: string, overrides: Record<string, unknown> = {}) {
  fake.seed(`materials/${id}`, {
    name: "Plata fina",
    kind: "fine_silver",
    unit: "g",
    stock: 100,
    avgCost: 1500,
    createdAt: new FakeTimestamp(new Date("2026-09-01T12:00:00Z")),
    updatedAt: new FakeTimestamp(new Date("2026-09-01T12:00:00Z")),
    ...overrides,
  });
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

describe("createMaterial", () => {
  it("creates an EMPTY material and its audit entry in one transaction", async () => {
    const created = await createMaterial(
      { name: "Plata fina", kind: "fine_silver", unit: "g" },
      ACTOR,
    );

    expect(created).toEqual({ id: expect.any(String) });
    expect(fake.transactionsRun).toBe(1);

    const [material, audit] = fake.committed;
    expect(material).toEqual({
      kind: "create",
      path: `materials/${created?.id}`,
      data: {
        name: "Plata fina",
        kind: "fine_silver",
        unit: "g",
        stock: 0,
        avgCost: 0,
        createdAt: SERVER_TIMESTAMP,
        updatedAt: SERVER_TIMESTAMP,
      },
    });
    expect(audit).toMatchObject({ kind: "create" });
    expect(audit.path).toMatch(AUDIT_PATH);
  });

  it("writes an audit entry that says who, what, which and when — and no values", async () => {
    const created = await createMaterial(
      { name: "Secreto", kind: "other", unit: "pz" },
      ACTOR,
    );

    const audit = fake.opsMatching(AUDIT_PATH, "create")[0];
    expect(audit.kind === "delete" ? null : audit.data).toEqual({
      actor: ACTOR,
      action: "material.create",
      entity: "material",
      entityId: created?.id,
      at: SERVER_TIMESTAMP,
    });
    // The name is a value: it must not leak into the audit log.
    expect(JSON.stringify(audit)).not.toContain("Secreto");
  });

  it("does not persist unexpected extra properties, nor a made-up balance", async () => {
    await createMaterial(
      {
        name: "Plata fina",
        kind: "fine_silver",
        unit: "g",
        stock: 9999,
        avgCost: 1,
      } as unknown as Parameters<typeof createMaterial>[0],
      ACTOR,
    );

    const op = fake.opsMatching(MATERIAL_PATH, "create")[0];
    const data = op.kind === "delete" ? {} : op.data;
    expect(Object.keys(data).sort()).toEqual(
      ["avgCost", "createdAt", "kind", "name", "stock", "unit", "updatedAt"].sort(),
    );
    expect(data.stock).toBe(0);
    expect(data.avgCost).toBe(0);
  });

  it("returns null and writes nothing when Firebase is not configured", async () => {
    configured = false;

    await expect(
      createMaterial({ name: "Plata", kind: "fine_silver", unit: "g" }, ACTOR),
    ).resolves.toBeNull();
    expect(fake.committed).toHaveLength(0);
  });

  it("rejects, rather than reporting success, when Firestore fails", async () => {
    vi.spyOn(fake, "runTransaction").mockRejectedValueOnce(new Error("unavailable"));

    await expect(
      createMaterial({ name: "Plata", kind: "fine_silver", unit: "g" }, ACTOR),
    ).rejects.toThrow("unavailable");
  });
});

describe("adjustStock", () => {
  it("removes stock, records a reasoned movement and does NOT touch avgCost", async () => {
    seedMaterial("m1");

    const result = await adjustStock(
      { materialId: "m1", delta: -2.5, kind: "adjustment", reason: "Conteo físico" },
      ACTOR,
    );

    expect(result).toEqual({ stock: 97.5 });

    const update = fake.opsMatching(MATERIAL_PATH, "update")[0];
    expect(update.kind === "delete" ? null : Object.keys(update.data).sort()).toEqual([
      "stock",
      "updatedAt",
    ]);
    expect(fake.get("materials/m1")).toMatchObject({ stock: 97.5, avgCost: 1500 });

    const movement = fake.opsMatching(MOVEMENT_PATH, "create")[0];
    expect(movement.kind === "delete" ? null : movement.data).toEqual({
      type: "adjustment",
      qty: -2.5,
      unitCost: 1500,
      totalCost: 3750,
      note: "Conteo físico",
      createdAt: SERVER_TIMESTAMP,
      actor: ACTOR,
    });
  });

  it("adds stock with a positive correction", async () => {
    seedMaterial("m1", { stock: 10 });

    await expect(
      adjustStock(
        { materialId: "m1", delta: 4.25, kind: "adjustment", reason: "Faltaba contar" },
        ACTOR,
      ),
    ).resolves.toEqual({ stock: 14.25 });
  });

  it("records a loss (merma) as its own movement type", async () => {
    seedMaterial("m1");

    await adjustStock(
      { materialId: "m1", delta: -1.2, kind: "loss", reason: "Limaduras" },
      ACTOR,
    );

    const movement = fake.opsMatching(MOVEMENT_PATH, "create")[0];
    expect(movement.kind === "delete" ? null : movement.data.type).toBe("loss");
  });

  it("refuses a 'loss' that adds stock, writing nothing", async () => {
    seedMaterial("m1");

    await expect(
      codeOf(
        adjustStock(
          { materialId: "m1", delta: 3, kind: "loss", reason: "No es merma" },
          ACTOR,
        ),
      ),
    ).resolves.toBe("invalid-quantity");
    expect(fake.committed).toHaveLength(0);
  });

  it("rejects with a typed insufficient-stock error and writes NOTHING", async () => {
    seedMaterial("m1", { stock: 5 });

    await expect(
      codeOf(
        adjustStock(
          { materialId: "m1", delta: -5.01, kind: "adjustment", reason: "Demasiado" },
          ACTOR,
        ),
      ),
    ).resolves.toBe("insufficient-stock");

    expect(fake.committed).toHaveLength(0);
    expect(fake.get("materials/m1")).toMatchObject({ stock: 5 });
  });

  it("can take stock exactly to zero", async () => {
    seedMaterial("m1", { stock: 62.35 });

    await expect(
      adjustStock(
        { materialId: "m1", delta: -62.35, kind: "adjustment", reason: "Se acabó" },
        ACTOR,
      ),
    ).resolves.toEqual({ stock: 0 });
  });

  it("rejects an unknown material without writing", async () => {
    await expect(
      codeOf(
        adjustStock(
          { materialId: "ghost", delta: 1, kind: "adjustment", reason: "Fantasma" },
          ACTOR,
        ),
      ),
    ).resolves.toBe("material-not-found");
    expect(fake.committed).toHaveLength(0);
  });

  it("refuses a malformed id before opening a transaction", async () => {
    await expect(
      codeOf(
        adjustStock(
          { materialId: "a/b/c", delta: 1, kind: "adjustment", reason: "Ruta ajena" },
          ACTOR,
        ),
      ),
    ).resolves.toBe("material-not-found");
    expect(fake.transactionsRun).toBe(0);
  });

  it("refuses a fractional quantity of pieces", async () => {
    seedMaterial("m2", { name: "Circón", kind: "stone", unit: "pz", stock: 10, avgCost: 500 });

    await expect(
      codeOf(
        adjustStock(
          { materialId: "m2", delta: -0.5, kind: "adjustment", reason: "Media pieza" },
          ACTOR,
        ),
      ),
    ).resolves.toBe("invalid-quantity");
    expect(fake.committed).toHaveLength(0);
  });

  it("writes an audit entry without values", async () => {
    seedMaterial("m1");

    await adjustStock(
      { materialId: "m1", delta: -2.5, kind: "adjustment", reason: "Motivo secreto" },
      ACTOR,
    );

    const audit = fake.opsMatching(AUDIT_PATH, "create")[0];
    expect(audit.kind === "delete" ? null : audit.data).toEqual({
      actor: ACTOR,
      action: "stock.adjust",
      entity: "material",
      entityId: "m1",
      at: SERVER_TIMESTAMP,
    });
    expect(JSON.stringify(audit)).not.toContain("secreto");
  });

  it("only ever CREATES movements: an existing one is never updated or deleted", async () => {
    seedMaterial("m1");

    await adjustStock(
      { materialId: "m1", delta: -1, kind: "adjustment", reason: "Uno" },
      ACTOR,
    );
    await adjustStock(
      { materialId: "m1", delta: -1, kind: "adjustment", reason: "Dos" },
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
      adjustStock(
        { materialId: "m1", delta: 1, kind: "adjustment", reason: "Sin base" },
        ACTOR,
      ),
    ).resolves.toBeNull();
  });
});

describe("listMovements", () => {
  function seedMovement(index: number, extra: Record<string, unknown> = {}) {
    fake.seed(`materials/m1/movements/mv${String(index).padStart(3, "0")}`, {
      type: "adjustment",
      qty: -1,
      createdAt: new FakeTimestamp(new Date(Date.UTC(2026, 8, 1, 0, 0, index))),
      actor: ACTOR,
      ...extra,
    });
  }

  it("reads the material's subcollection, newest first, with one extra document", async () => {
    seedMovement(1);

    await listMovements("m1");

    expect(fake.queries).toEqual([
      {
        collection: "materials/m1/movements",
        wheres: [],
        orderBys: [{ field: "createdAt", direction: "desc" }],
        offset: 0,
        limit: MOVEMENTS_PAGE_SIZE + 1,
        select: undefined,
      },
    ]);
  });

  it("returns the newest movement first", async () => {
    seedMovement(1, { note: "primero" });
    seedMovement(2, { note: "segundo" });
    seedMovement(3, { note: "tercero" });

    const page = await listMovements("m1");

    expect(page?.movements.map((movement) => movement.note)).toEqual([
      "tercero",
      "segundo",
      "primero",
    ]);
    expect(page?.hasNextPage).toBe(false);
  });

  it("cuts pages and reports a next page via the extra document", async () => {
    for (let index = 1; index <= MOVEMENTS_PAGE_SIZE + 1; index += 1) {
      seedMovement(index);
    }

    const first = await listMovements("m1", 1);
    const second = await listMovements("m1", 2);

    expect(first?.movements).toHaveLength(MOVEMENTS_PAGE_SIZE);
    expect(first?.hasNextPage).toBe(true);
    expect(second?.movements).toHaveLength(1);
    expect(second?.hasNextPage).toBe(false);
  });

  it.each([0, -1, 1.5, Number.NaN, 201, 1e9])(
    "falls back to the first page for the out-of-range page %s",
    async (page) => {
      seedMovement(1);

      await listMovements("m1", page);

      expect(fake.queries[0].offset).toBe(0);
    },
  );

  it("maps costs, reference and note, and coerces hand-edited documents", async () => {
    seedMovement(1, {
      type: "purchase",
      qty: 5,
      unitCost: 1800,
      totalCost: 9000,
      refId: "p1",
      note: "Compra",
    });
    seedMovement(2, {
      type: "bogus",
      qty: "many",
      unitCost: -3,
      totalCost: 1.5,
      refId: 7,
      note: "",
    });

    const page = await listMovements("m1");

    expect(page?.movements[1]).toEqual({
      id: "mv001",
      type: "purchase",
      qty: 5,
      unitCost: 1800,
      totalCost: 9000,
      refId: "p1",
      note: "Compra",
      createdAt: new Date("2026-09-01T00:00:01Z"),
    });
    expect(page?.movements[0]).toMatchObject({
      type: "adjustment",
      qty: 0,
      unitCost: 0,
      totalCost: 0,
      refId: null,
      note: null,
    });
  });

  it("returns null for a malformed id without querying", async () => {
    await expect(listMovements("../secrets")).resolves.toBeNull();
    await expect(listMovements("a/b")).resolves.toBeNull();
    expect(fake.queries).toHaveLength(0);
  });

  it("returns null when Firebase is not configured", async () => {
    configured = false;

    await expect(listMovements("m1")).resolves.toBeNull();
  });
});

describe("listMaterials", () => {
  it("lists by name with a bounded read", async () => {
    seedMaterial("m1", { name: "Plata fina" });
    seedMaterial("m2", { name: "Cobre", kind: "alloy" });
    seedMaterial("m3", { name: "Oro fino", kind: "fine_gold" });

    const materials = await listMaterials();

    expect(materials?.map((material) => material.name)).toEqual([
      "Cobre",
      "Oro fino",
      "Plata fina",
    ]);
    expect(fake.queries[0]).toMatchObject({
      collection: "materials",
      orderBys: [{ field: "name", direction: "asc" }],
      limit: MATERIALS_LIMIT,
    });
  });

  it("maps every field of a material", async () => {
    seedMaterial("m1");

    const materials = await listMaterials();

    expect(materials).toEqual([
      {
        id: "m1",
        name: "Plata fina",
        kind: "fine_silver",
        unit: "g",
        stock: 100,
        avgCost: 1500,
        createdAt: new Date("2026-09-01T12:00:00Z"),
        updatedAt: new Date("2026-09-01T12:00:00Z"),
      },
    ]);
  });

  it("coerces hand-edited documents to safe defaults instead of throwing", async () => {
    fake.seed("materials/m2", {
      name: "Raro",
      kind: "mystery",
      unit: "kg",
      stock: "lots",
      avgCost: 12.5,
      createdAt: "yesterday",
    });

    const materials = await listMaterials();

    expect(materials?.[0]).toEqual({
      id: "m2",
      name: "Raro",
      kind: "other",
      unit: "g",
      stock: 0,
      avgCost: 0,
      createdAt: null,
      updatedAt: null,
    });
  });

  it("returns null when Firebase is not configured", async () => {
    configured = false;

    await expect(listMaterials()).resolves.toBeNull();
  });
});
