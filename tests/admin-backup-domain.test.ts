import { describe, expect, it } from "vitest";
import { backupFilename, toJsonObject, toJsonValue } from "@/lib/admin/domain/backup";
import { FakeTimestamp } from "@/tests/helpers/fake-firestore";

describe("toJsonValue", () => {
  it("turns a Firestore Timestamp into an ISO string", () => {
    const stamp = new FakeTimestamp(new Date("2026-10-02T06:00:00.000Z"));

    expect(toJsonValue(stamp)).toBe("2026-10-02T06:00:00.000Z");
  });

  it("turns the Timestamps inside nested objects and arrays into ISO strings", () => {
    const stamp = new FakeTimestamp(new Date("2026-10-02T06:00:00.000Z"));

    expect(
      toJsonValue({
        date: stamp,
        items: [{ at: stamp, price: 1_000 }],
        deep: { deeper: { when: stamp } },
      }),
    ).toEqual({
      date: "2026-10-02T06:00:00.000Z",
      items: [{ at: "2026-10-02T06:00:00.000Z", price: 1_000 }],
      deep: { deeper: { when: "2026-10-02T06:00:00.000Z" } },
    });
  });

  it("turns a Date into an ISO string, and an unusable date into null", () => {
    expect(toJsonValue(new Date("2026-10-02T06:00:00.000Z"))).toBe(
      "2026-10-02T06:00:00.000Z",
    );
    expect(toJsonValue(new Date("not a date"))).toBeNull();
    expect(toJsonValue({ toDate: () => new Date("not a date") })).toBeNull();
    expect(toJsonValue({ toDate: () => "not a date" })).toBeNull();
  });

  it("keeps strings, booleans, finite numbers and null as they are", () => {
    expect(toJsonValue("Anillo Luna")).toBe("Anillo Luna");
    expect(toJsonValue(true)).toBe(true);
    expect(toJsonValue(185_000)).toBe(185_000);
    expect(toJsonValue(0)).toBe(0);
    expect(toJsonValue(null)).toBeNull();
  });

  it("drops undefined keys, and an undefined inside an array becomes null", () => {
    expect(toJsonValue({ a: 1, b: undefined })).toEqual({ a: 1 });
    expect(toJsonValue([1, undefined, 3])).toEqual([1, null, 3]);
    expect(toJsonValue(undefined)).toBeUndefined();
  });

  it("writes what JSON cannot hold as null (non-finite numbers) or a string (bigint)", () => {
    expect(toJsonValue(Number.NaN)).toBeNull();
    expect(toJsonValue(Number.POSITIVE_INFINITY)).toBeNull();
    expect(toJsonValue(BigInt(12))).toBe("12");
    expect(toJsonValue(() => 1)).toBeUndefined();
  });

  it("never walks a class instance: a reference that points at the client would leak its settings", () => {
    class DocumentReference {
      firestore = {
        settings: { credentials: { private_key: "-----BEGIN PRIVATE KEY-----SECRET" } },
      };
      path = "contactMessages/abc";
    }

    const out = toJsonValue({ ok: 1, ref: new DocumentReference(), bytes: Buffer.from("hi") });

    expect(out).toEqual({
      ok: 1,
      ref: "[unsupported: DocumentReference]",
      bytes: "[unsupported: Buffer]",
    });
    expect(JSON.stringify(out)).not.toContain("SECRET");
    expect(JSON.stringify(out)).not.toContain("private_key");
  });

  it("walks plain objects with no prototype too", () => {
    const bare = Object.create(null) as Record<string, unknown>;
    bare.n = 1;

    expect(toJsonValue(bare)).toEqual({ n: 1 });
  });

  it("cannot be used to reach an object prototype through a key", () => {
    const hostile: unknown = JSON.parse('{"__proto__": {"polluted": true}}');

    const out = toJsonValue(hostile) as Record<string, unknown>;

    expect(Object.keys(out)).toEqual(["__proto__"]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(out.polluted).toBeUndefined();
  });

  it("produces something JSON.stringify can write", () => {
    const stamp = new FakeTimestamp(new Date("2026-10-02T06:00:00.000Z"));
    const out = toJsonValue({ stamp, big: BigInt(1), nan: Number.NaN, items: [undefined] });

    expect(() => JSON.stringify(out)).not.toThrow();
  });
});

describe("toJsonObject", () => {
  it("returns a document's data as a JSON object", () => {
    const stamp = new FakeTimestamp(new Date("2026-10-02T06:00:00.000Z"));

    expect(toJsonObject({ createdAt: stamp, stock: 12.5 })).toEqual({
      createdAt: "2026-10-02T06:00:00.000Z",
      stock: 12.5,
    });
  });

  // One argument per row: a bare array case would be spread into several.
  it.each([[undefined], [null], [5], ["text"], [[1, 2]]])(
    "is an empty object for %j, which is not a document's data",
    (value) => {
      expect(toJsonObject(value)).toEqual({});
    },
  );
});

describe("backupFilename", () => {
  it("is nerea-respaldo-YYYY-MM-DD.json", () => {
    expect(backupFilename(new Date("2026-10-03T18:00:00Z"))).toBe(
      "nerea-respaldo-2026-10-03.json",
    );
  });

  it("dates the file in Mexico City, not in UTC", () => {
    // 21:00 on October 3rd in Mexico City is already the 4th in UTC.
    expect(backupFilename(new Date("2026-10-04T03:00:00Z"))).toBe(
      "nerea-respaldo-2026-10-03.json",
    );
    // 00:00 on October 3rd in Mexico City is 06:00 UTC; a second earlier is the 2nd.
    expect(backupFilename(new Date("2026-10-03T06:00:00Z"))).toBe(
      "nerea-respaldo-2026-10-03.json",
    );
    expect(backupFilename(new Date("2026-10-03T05:59:59Z"))).toBe(
      "nerea-respaldo-2026-10-02.json",
    );
  });
});
