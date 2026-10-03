import { describe, expect, it } from "vitest";
import {
  FakeFirestore,
  FakeTimestamp,
  SERVER_TIMESTAMP,
} from "@/tests/helpers/fake-firestore";

// The data-layer tests lean on this fake to PROVE rules (append-only ledger,
// no composite index, atomic transactions). That only means something if the
// fake itself refuses to let those rules slip, so it is tested here.

describe("fake Firestore strictness", () => {
  it("rejects a query that would need a composite index", async () => {
    const db = new FakeFirestore();
    const items = db.collection("purchases");

    // equality + orderBy on another field
    await expect(items.where("supplier", "==", "x").orderBy("date").get()).rejects.toThrow(
      /requires an index/,
    );
    // range on one field, orderBy on another
    await expect(items.where("date", ">=", 1).orderBy("totalCost").get()).rejects.toThrow(
      /requires an index/,
    );
    // two different ranged fields
    await expect(items.where("date", ">=", 1).where("totalCost", "<", 9).get()).rejects.toThrow(
      /requires an index/,
    );
  });

  it("serves a range plus orderBy on the SAME field from the automatic index", async () => {
    const db = new FakeFirestore();
    db.seed("purchases/a", { date: new FakeTimestamp(new Date("2026-10-01T00:00:00Z")) });
    db.seed("purchases/b", { date: new FakeTimestamp(new Date("2026-10-03T00:00:00Z")) });

    const result = await db
      .collection("purchases")
      .where("date", ">=", new FakeTimestamp(new Date("2026-10-02T00:00:00Z")))
      .orderBy("date", "desc")
      .get();

    expect(result.docs.map((doc) => doc.id)).toEqual(["b"]);
  });

  it("refuses reads after the first write, like a real transaction", async () => {
    const db = new FakeFirestore();
    db.seed("materials/m1", { stock: 1 });

    await expect(
      db.runTransaction(async (tx) => {
        tx.update(db.collection("materials").doc("m1"), { stock: 2 });
        await tx.get(db.collection("materials").doc("m1"));
      }),
    ).rejects.toThrow(/all reads to be executed before all writes/);
  });

  it("commits nothing when the transaction callback throws", async () => {
    const db = new FakeFirestore();

    await expect(
      db.runTransaction(async (tx) => {
        tx.create(db.collection("materials").doc("m1"), { stock: 1 });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(db.get("materials/m1")).toBeUndefined();
    expect(db.committed).toHaveLength(0);
  });

  it("makes `create` refuse an existing document, and rolls back the whole commit", async () => {
    const db = new FakeFirestore();
    db.seed("materials/m1/movements/mv1", { qty: 1 });

    await expect(
      db.runTransaction(async (tx) => {
        tx.create(db.collection("materials").doc("m2"), { stock: 5 });
        tx.create(db.collection("materials").doc("m1").collection("movements").doc("mv1"), {
          qty: 99,
        });
      }),
    ).rejects.toThrow(/ALREADY_EXISTS/);

    // The first write was discarded with the second, and the movement is intact.
    expect(db.get("materials/m2")).toBeUndefined();
    expect(db.get("materials/m1/movements/mv1")).toEqual({ qty: 1 });
  });

  it("refuses to update a document that does not exist", async () => {
    const db = new FakeFirestore();

    await expect(
      db.runTransaction(async (tx) => {
        tx.update(db.collection("materials").doc("ghost"), { stock: 1 });
      }),
    ).rejects.toThrow(/NOT_FOUND/);
  });

  it("requires at least one reference for getAll, like the real SDK", async () => {
    const db = new FakeFirestore();

    await expect(db.runTransaction((tx) => tx.getAll())).rejects.toThrow(
      /requires at least 1 argument/,
    );
  });

  it("resolves server timestamps at commit, increasing over time", async () => {
    const db = new FakeFirestore();

    await db.runTransaction(async (tx) => {
      tx.create(db.collection("log").doc("one"), { at: SERVER_TIMESTAMP });
    });
    await db.runTransaction(async (tx) => {
      tx.create(db.collection("log").doc("two"), { at: SERVER_TIMESTAMP });
    });

    const first = (db.get("log/one")?.at as FakeTimestamp).toDate().getTime();
    const second = (db.get("log/two")?.at as FakeTimestamp).toDate().getTime();
    expect(second).toBeGreaterThan(first);
  });

  it("returns only the selected fields from a select() query", async () => {
    const db = new FakeFirestore();
    db.seed("purchases/a", { totalCost: 5, supplier: "private" });

    const result = await db.collection("purchases").select("totalCost").get();

    expect(result.docs[0].data()).toEqual({ totalCost: 5 });
  });
});

describe("fake Firestore cursors and counts", () => {
  function seedSales(db: FakeFirestore) {
    // Three sales share one date, as sales of the same business day do.
    db.seed("sales/a", { date: new FakeTimestamp(new Date("2026-10-03T06:00:00Z")), n: 1 });
    db.seed("sales/b", { date: new FakeTimestamp(new Date("2026-10-02T06:00:00Z")), n: 2 });
    db.seed("sales/c", { date: new FakeTimestamp(new Date("2026-10-02T06:00:00Z")), n: 3 });
    db.seed("sales/d", { date: new FakeTimestamp(new Date("2026-10-02T06:00:00Z")), n: 4 });
    db.seed("sales/e", { date: new FakeTimestamp(new Date("2026-10-01T06:00:00Z")), n: 5 });
  }

  it("resumes right after the cursor DOCUMENT, so documents sharing a sort value are neither skipped nor repeated", async () => {
    const db = new FakeFirestore();
    seedSales(db);
    const ordered = db.collection("sales").orderBy("date", "desc");

    const first = await ordered.limit(2).get();
    const second = await ordered.startAfter(first.docs[1]).limit(2).get();
    const third = await ordered.startAfter(second.docs[1]).limit(2).get();

    const ids = [...first.docs, ...second.docs, ...third.docs].map((doc) => doc.id);
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);
    expect(third.docs).toHaveLength(1);
  });

  it("records the cursor on the query", async () => {
    const db = new FakeFirestore();
    seedSales(db);
    const ordered = db.collection("sales").orderBy("date");
    const first = await ordered.limit(1).get();

    await ordered.startAfter(first.docs[0]).get();

    expect(db.queries[1].startAfter).toBe(first.docs[0].ref.path);
  });

  it("refuses a cursor document that lacks a field the query orders by, like the real SDK", async () => {
    const db = new FakeFirestore();
    seedSales(db);
    const projected = db.collection("sales").orderBy("date").select("n");
    const first = await projected.limit(1).get();

    // `select("n")` dropped `date`, which the query is ordered by.
    expect(() => projected.startAfter(first.docs[0])).toThrow(
      /Field "date" is missing in the provided DocumentSnapshot/,
    );
  });

  it("refuses a cursor document that is not in the query", async () => {
    const db = new FakeFirestore();
    seedSales(db);
    db.seed("sales/z", { date: new FakeTimestamp(new Date("2025-01-01T06:00:00Z")), n: 9 });
    const outside = await db
      .collection("sales")
      .where("date", ">=", new FakeTimestamp(new Date("2025-01-01T00:00:00Z")))
      .orderBy("date")
      .limit(1)
      .get();

    await expect(
      db
        .collection("sales")
        .where("date", ">=", new FakeTimestamp(new Date("2026-01-01T00:00:00Z")))
        .orderBy("date")
        .startAfter(outside.docs[0])
        .get(),
    ).rejects.toThrow(/cursor document is not in this query/);
  });

  it("counts the documents that match, with an equality filter alone", async () => {
    const db = new FakeFirestore();
    db.seed("contactMessages/a", { read: false });
    db.seed("contactMessages/b", { read: true });
    db.seed("contactMessages/c", { read: false });

    const snapshot = await db
      .collection("contactMessages")
      .where("read", "==", false)
      .count()
      .get();

    expect(snapshot.data().count).toBe(2);
    expect(db.queries[0].aggregate).toBe("count");
  });
});
