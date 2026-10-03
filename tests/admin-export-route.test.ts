import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeFirestore, FakeTimestamp } from "@/tests/helpers/fake-firestore";

// The backup download: who may fetch it, how it is delivered and what is in
// it. Firestore is the in-memory fake behind the same `getAdminDb` edge the
// data tests use, so the REAL reader (batches, subcollections, serialization)
// runs here, not a stub of it.
vi.mock("server-only", () => ({}));

const getAdminOrNullMock = vi.fn();
vi.mock("@/lib/admin/auth/session", () => ({
  getAdminOrNull: (...args: unknown[]) => getAdminOrNullMock(...args),
}));

let fake: FakeFirestore;
let configured = true;
vi.mock("@/lib/admin/firebase/admin", () => ({
  getAdminDb: () => (configured ? fake : undefined),
}));

import { GET } from "@/app/admin/api/export/route";
import { BACKUP_FORMAT, BACKUP_MAX_DOCS, readBackup } from "@/lib/admin/data/backup";

const ADMIN = { uid: "uid-1", email: "admin@example.com" };

function ts(iso: string) {
  return new FakeTimestamp(new Date(iso));
}

function seedEverything() {
  fake.seed("materials/m1", {
    name: "Plata fina",
    kind: "fine_silver",
    unit: "g",
    stock: 90,
    avgCost: 1_800,
    createdAt: ts("2026-09-01T10:00:00Z"),
    updatedAt: ts("2026-10-02T10:00:00Z"),
  });
  fake.seed("materials/m1/movements/mv1", {
    type: "purchase",
    qty: 100,
    unitCost: 1_800,
    totalCost: 180_000,
    createdAt: ts("2026-09-01T10:00:00Z"),
    actor: "uid-1",
  });
  fake.seed("materials/m1/movements/mv2", {
    type: "casting",
    qty: -10,
    createdAt: ts("2026-09-05T10:00:00Z"),
    actor: "uid-1",
  });
  fake.seed("materials/m2", { name: "Circones", kind: "stone", unit: "pz", stock: 0, avgCost: 0 });
  fake.seed("purchases/p1", {
    date: ts("2026-09-01T06:00:00Z"),
    totalCost: 180_000,
    items: [{ materialId: "m1", materialName: "Plata fina", qty: 100, totalCost: 180_000 }],
    createdAt: ts("2026-09-01T10:00:00Z"),
  });
  fake.seed("castings/c1", {
    date: ts("2026-09-05T06:00:00Z"),
    outputs: { metalGrams: 10 },
  });
  fake.seed("pieces/anillo-luna", {
    handle: "anillo-luna",
    costs: { metal: 40_000, stones: 15_000, other: 5_000 },
    updatedAt: ts("2026-10-01T12:00:00Z"),
  });
  fake.seed("sales/s1", {
    source: "manual",
    status: "active",
    date: ts("2026-10-01T06:00:00Z"),
    subtotal: 185_000,
    createdAt: ts("2026-10-01T15:00:00Z"),
  });
  fake.seed("contactMessages/cm1", {
    name: "Ana Pérez",
    email: "ana@example.com",
    message: "Hola, ¿tienen talla 7?",
    createdAt: ts("2026-10-02T15:00:00Z"),
    read: false,
  });
  fake.seed("auditLog/a1", {
    actor: "uid-1",
    action: "sale.record",
    entity: "sale",
    entityId: "s1",
    at: ts("2026-10-01T15:00:00Z"),
  });
}

async function bodyOf(response: Response) {
  return JSON.parse(await response.text());
}

beforeEach(() => {
  vi.resetAllMocks();
  fake = new FakeFirestore();
  configured = true;
  getAdminOrNullMock.mockResolvedValue(ADMIN);
  // 2026-10-03 21:00 in Mexico City: already the 4th in UTC.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-04T03:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("GET /admin/api/export: who may download", () => {
  it("answers 401 JSON, with no-store, to someone who is not an admin, and reads nothing", async () => {
    getAdminOrNullMock.mockResolvedValue(null);
    seedEverything();

    const response = await GET();

    expect(response.status).toBe(401);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await bodyOf(response)).toEqual({ error: "unauthorized" });
    // Not a byte of the data was even queried, and nothing invites a download.
    expect(fake.queries).toHaveLength(0);
    expect(response.headers.get("Content-Disposition")).toBeNull();
  });

  it("checks the session before touching Firestore", async () => {
    seedEverything();
    const collectionSpy = vi.spyOn(fake, "collection");

    await GET();

    expect(getAdminOrNullMock).toHaveBeenCalledTimes(1);
    expect(collectionSpy).toHaveBeenCalled();
    expect(getAdminOrNullMock.mock.invocationCallOrder[0]).toBeLessThan(
      collectionSpy.mock.invocationCallOrder[0],
    );
  });

  it("answers 503 when Firebase isn't configured", async () => {
    configured = false;

    const response = await GET();

    expect(response.status).toBe(503);
    expect(await bodyOf(response)).toEqual({ error: "not-configured" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("GET /admin/api/export: delivery", () => {
  it("is a JSON attachment named after the Mexico City date, never cached", async () => {
    seedEverything();

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="nerea-respaldo-2026-10-03.json"',
    );
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("names the file with the Mexico date at the other edge of the day too", async () => {
    vi.setSystemTime(new Date("2026-10-03T05:59:59Z")); // still the 2nd in Mexico City

    const response = await GET();

    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="nerea-respaldo-2026-10-02.json"',
    );
  });
});

describe("GET /admin/api/export: contents", () => {
  it("includes every collection, each document as { id, data }", async () => {
    seedEverything();

    const body = await bodyOf(await GET());

    expect(body).toMatchObject({
      app: "nerea",
      format: BACKUP_FORMAT,
      exportedAt: "2026-10-04T03:00:00.000Z",
      truncated: [],
    });
    expect(Object.keys(body.collections).sort()).toEqual([
      "auditLog",
      "castings",
      "contactMessages",
      "materials",
      "pieces",
      "purchases",
      "sales",
    ]);
    expect(body.collections.purchases).toEqual([
      {
        id: "p1",
        data: {
          date: "2026-09-01T06:00:00.000Z",
          totalCost: 180_000,
          items: [
            { materialId: "m1", materialName: "Plata fina", qty: 100, totalCost: 180_000 },
          ],
          createdAt: "2026-09-01T10:00:00.000Z",
        },
      },
    ]);
    expect(body.collections.castings[0].id).toBe("c1");
    expect(body.collections.pieces[0].id).toBe("anillo-luna");
    expect(body.collections.sales[0].data.subtotal).toBe(185_000);
    expect(body.collections.auditLog[0].data.action).toBe("sale.record");
  });

  it("turns every Timestamp, however deeply nested, into an ISO string", async () => {
    seedEverything();

    const text = await (await GET()).text();
    const body = JSON.parse(text);

    expect(body.collections.sales[0].data.date).toBe("2026-10-01T06:00:00.000Z");
    expect(body.collections.contactMessages[0].data.createdAt).toBe(
      "2026-10-02T15:00:00.000Z",
    );
    expect(body.collections.materials[0].data.updatedAt).toBe("2026-10-02T10:00:00.000Z");
    // Nothing of a Timestamp's internals reaches the file.
    expect(text).not.toMatch(/seconds|nanoseconds|_seconds|\bvalue\b/);
  });

  it("includes each material's movements subcollection, nested under the material", async () => {
    seedEverything();

    const { collections } = await bodyOf(await GET());

    const silver = collections.materials.find((material: { id: string }) => material.id === "m1");
    expect(silver.data).toMatchObject({ name: "Plata fina", stock: 90 });
    expect(silver.movements.map((movement: { id: string }) => movement.id)).toEqual([
      "mv1",
      "mv2",
    ]);
    expect(silver.movements[0]).toEqual({
      id: "mv1",
      data: {
        type: "purchase",
        qty: 100,
        unitCost: 1_800,
        totalCost: 180_000,
        createdAt: "2026-09-01T10:00:00.000Z",
        actor: "uid-1",
      },
    });

    // A material with no history still has the (empty) list.
    const stones = collections.materials.find((material: { id: string }) => material.id === "m2");
    expect(stones.movements).toEqual([]);
  });

  it("does not mix one material's movements into another's", async () => {
    seedEverything();
    fake.seed("materials/m2/movements/mv9", {
      type: "adjustment",
      qty: 5,
      createdAt: ts("2026-10-01T10:00:00Z"),
    });

    const { collections } = await bodyOf(await GET());

    const byId = (id: string) =>
      collections.materials.find((material: { id: string }) => material.id === id);
    expect(byId("m1").movements.map((movement: { id: string }) => movement.id)).toEqual([
      "mv1",
      "mv2",
    ]);
    expect(byId("m2").movements.map((movement: { id: string }) => movement.id)).toEqual(["mv9"]);
  });

  it("keeps the contact messages' personal data: that is what a backup is for", async () => {
    seedEverything();

    const { collections } = await bodyOf(await GET());

    expect(collections.contactMessages[0].data).toMatchObject({
      name: "Ana Pérez",
      email: "ana@example.com",
      message: "Hola, ¿tienen talla 7?",
    });
  });

  it("never serializes a value it does not understand, such as a reference to the client", async () => {
    class DocumentReference {
      firestore = { settings: { credentials: { private_key: "TOP-SECRET-KEY" } } };
    }
    fake.seed("sales/odd", { subtotal: 1, hand_edited: new DocumentReference() });

    const text = await (await GET()).text();

    expect(text).toContain("[unsupported: DocumentReference]");
    expect(text).not.toContain("TOP-SECRET-KEY");
  });

  it("reads whole collections in batches of 500, with a cursor and no offset, losing nothing", async () => {
    for (let index = 1; index <= 1100; index += 1) {
      fake.seed(`auditLog/a${String(index).padStart(4, "0")}`, {
        actor: "uid-1",
        action: "sale.record",
        entity: "sale",
        entityId: `s${index}`,
        at: ts("2026-10-01T15:00:00Z"),
      });
    }

    const { collections } = await bodyOf(await GET());

    expect(collections.auditLog).toHaveLength(1100);
    expect(new Set(collections.auditLog.map((entry: { id: string }) => entry.id)).size).toBe(1100);

    const auditQueries = fake.queries.filter((query) => query.collection === "auditLog");
    expect(auditQueries.map((query) => query.limit)).toEqual([500, 500, 500]);
    expect(auditQueries.every((query) => query.offset === undefined)).toBe(true);
    expect(auditQueries[1].startAfter).toBeDefined();
  });

  it("only scans: no filter, no order, no projection, so no index is involved", async () => {
    seedEverything();

    await GET();

    expect(fake.queries.length).toBeGreaterThan(0);
    for (const query of fake.queries) {
      expect(query.wheres).toEqual([]);
      expect(query.orderBys).toEqual([]);
      expect(query.select).toBeUndefined();
    }
  });

  it("is a complete, empty backup for an empty database", async () => {
    const body = await bodyOf(await GET());

    expect(body.truncated).toEqual([]);
    for (const documents of Object.values(body.collections)) {
      expect(documents).toEqual([]);
    }
  });
});

describe("GET /admin/api/export: logging and failure", () => {
  function spyOnConsole() {
    return (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {}),
    );
  }

  it("never logs anything while it exports, personal data included", async () => {
    const spies = spyOnConsole();
    seedEverything();

    await GET();

    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });

  it("answers a plain 500 and logs one fixed line when Firestore fails, never the cause", async () => {
    const [, , , error] = spyOnConsole();
    vi.spyOn(fake, "collection").mockImplementation(() => {
      throw new Error("5 NOT_FOUND: contactMessages/ana@example.com secret-detail");
    });

    const response = await GET();

    expect(response.status).toBe(500);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await bodyOf(response)).toEqual({ error: "export-failed" });
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith("[admin] The backup could not be read.");
  });
});

describe("readBackup: the safety ceiling", () => {
  it("names a collection that reaches the ceiling and keeps only what fits", async () => {
    for (const id of ["p1", "p2", "p3"]) {
      fake.seed(`purchases/${id}`, { totalCost: 1 });
    }
    fake.seed("sales/s1", { subtotal: 1 });

    const backup = await readBackup({ maxDocsPerCollection: 2 });

    expect(backup?.truncated).toEqual(["purchases"]);
    expect(backup?.collections.purchases.map((purchase) => purchase.id)).toEqual(["p1", "p2"]);
    expect(backup?.collections.sales).toHaveLength(1);
  });

  it("names a material's movements when THEY reach the ceiling", async () => {
    fake.seed("materials/m1", { name: "Plata fina" });
    for (const id of ["mv1", "mv2", "mv3"]) {
      fake.seed(`materials/m1/movements/${id}`, { qty: 1 });
    }

    const backup = await readBackup({ maxDocsPerCollection: 2 });

    expect(backup?.truncated).toEqual(["materials/m1/movements"]);
    expect(backup?.collections.materials[0].movements).toHaveLength(2);
  });

  it("is far above anything this business will hold", () => {
    expect(BACKUP_MAX_DOCS).toBeGreaterThanOrEqual(10_000);
  });
});
