import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ConflictError,
  DRAFT_FILTER,
  FakeSanity,
  type StoredDoc,
} from "@/tests/helpers/fake-sanity";

// getSanityWriteClient is mocked entirely so this file tests exactly
// decrementStock's own handle -> transaction -> follow-up orchestration,
// decoupled from the real @sanity/client SDK (the pattern of
// tests/contact-submit.test.ts). The stand-in is tests/helpers/fake-sanity.ts:
// transactions are atomic, a refused `create` rolls the whole one back, and a
// committed transaction answers with the documents AS THEY ARE AFTER it.
const getSanityWriteClientMock = vi.fn();

vi.mock("@/lib/sanity/write-client", () => ({
  getSanityWriteClient: () => getSanityWriteClientMock(),
}));

import {
  PRODUCT_STOCK_BY_HANDLE_QUERY,
  decrementStock,
  stockMoveId,
  type StockDecrement,
} from "@/lib/commerce/sanity/stock";

let sanity: FakeSanity;

// The sale these tests decrement for: a Stripe Checkout Session id.
const SALE = "cs_test_a1B2c3D4";
const apply = (items: readonly StockDecrement[], source: string = SALE) =>
  decrementStock(items, source);

function doc(slug: string, fields: Partial<StoredDoc> = {}): StoredDoc {
  return { _id: `id-${slug}`, slug, status: "available", ...fields };
}

const hashOf = (handle: string) =>
  createHash("sha256").update(handle).digest("hex").slice(0, 32);

beforeEach(() => {
  sanity = new FakeSanity();
  getSanityWriteClientMock.mockImplementation(() => sanity);
});

afterEach(() => {
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

describe("decrementStock", () => {
  it("looks the handle up with a parameterized query, then lowers the stock in ONE transaction: setIfMissing, then dec", async () => {
    sanity = new FakeSanity(doc("anillo-luna", { stock: 5 }));

    const result = await apply([{ handle: "anillo-luna", qty: 2 }]);

    expect(sanity.fetch).toHaveBeenCalledWith(
      expect.stringContaining("$handle"),
      { handle: "anillo-luna" },
    );
    expect(sanity.writes).toEqual([
      {
        id: "id-anillo-luna",
        ops: [
          { kind: "setIfMissing", fields: { stock: 1 } },
          { kind: "dec", fields: { stock: 2 } },
        ],
      },
    ]);
    expect(sanity.docs.get("id-anillo-luna")?.stock).toBe(3);
    expect(result).toEqual({
      decremented: ["anillo-luna"],
      missing: [],
      failed: [],
      oversold: [],
      alreadyApplied: [],
    });
  });

  it("does not change the legacy status of a piece that still has stock", async () => {
    sanity = new FakeSanity(doc("anillo-luna", { stock: 5 }));

    await apply([{ handle: "anillo-luna", qty: 2 }]);

    // One write: the transaction. No follow-up patch.
    expect(sanity.writes).toHaveLength(1);
    expect(sanity.docs.get("id-anillo-luna")?.status).toBe("available");
  });

  describe("a document that predates the stock field", () => {
    it("starts from one piece (setIfMissing { stock: 1 }), so one sale takes it to 0 and flips it to sold", async () => {
      sanity = new FakeSanity(doc("anillo-luna", { status: "available" }));

      const result = await apply([{ handle: "anillo-luna", qty: 1 }]);

      expect(sanity.writes[0].ops[0]).toEqual({
        kind: "setIfMissing",
        fields: { stock: 1 },
      });
      expect(sanity.docs.get("id-anillo-luna")).toMatchObject({ stock: 0, status: "sold" });
      expect(result.decremented).toEqual(["anillo-luna"]);
      expect(result.oversold).toEqual([]);
    });

    it("starts from NONE when its legacy status is sold: selling it again is an oversell, clamped to 0", async () => {
      sanity = new FakeSanity(doc("anillo-luna", { status: "sold" }));

      const result = await apply([{ handle: "anillo-luna", qty: 1 }]);

      expect(sanity.writes[0].ops[0]).toEqual({
        kind: "setIfMissing",
        fields: { stock: 0 },
      });
      expect(sanity.docs.get("id-anillo-luna")).toMatchObject({ stock: 0, status: "sold" });
      expect(result.oversold).toEqual(["anillo-luna"]);
    });

    it("fails safe like the storefront does: an unknown status counts as no stock", async () => {
      sanity = new FakeSanity(doc("anillo-luna", { status: "weird" }));

      const result = await apply([{ handle: "anillo-luna", qty: 1 }]);

      expect(sanity.writes[0].ops[0]).toEqual({ kind: "setIfMissing", fields: { stock: 0 } });
      expect(result.oversold).toEqual(["anillo-luna"]);
    });
  });

  describe("reaching zero", () => {
    it("marks the piece sold, without rewriting a stock that is already right", async () => {
      sanity = new FakeSanity(doc("anillo-luna", { stock: 1 }));

      const result = await apply([{ handle: "anillo-luna", qty: 1 }]);

      expect(sanity.docs.get("id-anillo-luna")).toMatchObject({ stock: 0, status: "sold" });
      // The follow-up sets the status ONLY: a concurrent restock is not clobbered.
      expect(sanity.writes[1]).toEqual({
        id: "id-anillo-luna",
        ops: [{ kind: "set", fields: { status: "sold" } }],
      });
      expect(result.oversold).toEqual([]);
    });

    it("sells the last copies of a series down to exactly zero", async () => {
      sanity = new FakeSanity(doc("serie", { stock: 3 }));

      const result = await apply([{ handle: "serie", qty: 3 }]);

      expect(sanity.docs.get("id-serie")).toMatchObject({ stock: 0, status: "sold" });
      expect(result.decremented).toEqual(["serie"]);
      expect(result.oversold).toEqual([]);
    });
  });

  describe("an oversell", () => {
    it("clamps a negative result back to 0, marks the piece sold and reports it as oversold", async () => {
      sanity = new FakeSanity(doc("anillo-luna", { stock: 1 }));

      const result = await apply([{ handle: "anillo-luna", qty: 3 }]);

      expect(sanity.docs.get("id-anillo-luna")).toMatchObject({ stock: 0, status: "sold" });
      expect(sanity.writes[1]).toEqual({
        id: "id-anillo-luna",
        ops: [{ kind: "set", fields: { stock: 0, status: "sold" } }],
      });
      // It WAS decremented (the sale happened); it is also flagged.
      expect(result.decremented).toEqual(["anillo-luna"]);
      expect(result.oversold).toEqual(["anillo-luna"]);
    });

    it("sees a concurrent oversell: two DIFFERENT sales of the last piece, the second one is oversold", async () => {
      sanity = new FakeSanity(doc("anillo-luna", { stock: 1 }));

      const first = await apply([{ handle: "anillo-luna", qty: 1 }], "cs_test_one");
      const second = await apply([{ handle: "anillo-luna", qty: 1 }], "cs_test_two");

      expect(first.oversold).toEqual([]);
      expect(second.oversold).toEqual(["anillo-luna"]);
      expect(sanity.docs.get("id-anillo-luna")).toMatchObject({ stock: 0, status: "sold" });
    });

    it("still reports the oversell when the clamp itself cannot be written", async () => {
      sanity = new FakeSanity(doc("anillo-luna", { stock: 1 }));
      sanity.failSetFor.add("anillo-luna");

      const result = await apply([{ handle: "anillo-luna", qty: 2 }]);

      expect(result.decremented).toEqual(["anillo-luna"]);
      expect(result.oversold).toEqual(["anillo-luna"]);
      expect(result.failed).toEqual([]);
    });
  });

  it("puts a stale 'sold' status right when units remain (the artisan restocked in Studio, where status is read-only)", async () => {
    sanity = new FakeSanity(doc("anillo-luna", { stock: 5, status: "sold" }));

    await apply([{ handle: "anillo-luna", qty: 1 }]);

    expect(sanity.docs.get("id-anillo-luna")).toMatchObject({ stock: 4, status: "available" });
  });

  it("does not fail a decrement that landed because the status bookkeeping could not be written", async () => {
    sanity = new FakeSanity(doc("anillo-luna", { stock: 1 }));
    sanity.failSetFor.add("anillo-luna");

    const result = await apply([{ handle: "anillo-luna", qty: 1 }]);

    // `stock` is what the storefront reads, and it is already 0.
    expect(result.decremented).toEqual(["anillo-luna"]);
    expect(result.failed).toEqual([]);
    expect(sanity.docs.get("id-anillo-luna")?.stock).toBe(0);
  });

  it("treats a commit answer without a readable stock as decremented, with no follow-up", async () => {
    sanity = new FakeSanity(doc("anillo-luna", { stock: 5 }));
    sanity.returnNothing = true;

    const result = await apply([{ handle: "anillo-luna", qty: 1 }]);

    expect(result.decremented).toEqual(["anillo-luna"]);
    expect(result.oversold).toEqual([]);
    expect(sanity.writes).toHaveLength(1);
  });

  describe("several handles and lines", () => {
    it("processes every handle independently", async () => {
      sanity = new FakeSanity(
        doc("anillo-luna", { stock: 4 }),
        doc("aretes-sol", { stock: 2 }),
      );

      const result = await apply([
        { handle: "anillo-luna", qty: 1 },
        { handle: "aretes-sol", qty: 2 },
      ]);

      expect(sanity.docs.get("id-anillo-luna")?.stock).toBe(3);
      expect(sanity.docs.get("id-aretes-sol")?.stock).toBe(0);
      expect(result.decremented).toEqual(["anillo-luna", "aretes-sol"]);
    });

    it("adds up the lines of one design into ONE decrement (two sizes of a ring) and ONE marker", async () => {
      sanity = new FakeSanity(doc("anillo-luna", { stock: 10 }));

      const result = await apply([
        { handle: "anillo-luna", qty: 2 },
        { handle: "anillo-luna", qty: 3 },
      ]);

      expect(sanity.fetch).toHaveBeenCalledTimes(1);
      expect(sanity.writes).toHaveLength(1);
      expect(sanity.writes[0].ops[1]).toEqual({ kind: "dec", fields: { stock: 5 } });
      expect(sanity.docs.get("id-anillo-luna")?.stock).toBe(5);
      expect(sanity.markers.size).toBe(1);
      expect(result.decremented).toEqual(["anillo-luna"]);
    });

    it("reports a handle with no matching document as MISSING — not an error — creating no marker for it", async () => {
      sanity = new FakeSanity(doc("aretes-sol", { stock: 2 }));

      const result = await apply([
        { handle: "borrada", qty: 1 },
        { handle: "aretes-sol", qty: 1 },
      ]);

      expect(result.decremented).toEqual(["aretes-sol"]);
      expect(result.missing).toEqual(["borrada"]);
      expect(result.failed).toEqual([]);
      expect(sanity.writes).toHaveLength(1);
      expect([...sanity.markers.keys()]).toEqual([stockMoveId(SALE, "aretes-sol")]);
    });

    it("reports a failed lookup as FAILED: not knowing whether the piece exists is not 'missing'", async () => {
      sanity = new FakeSanity(doc("anillo-luna", { stock: 2 }), doc("aretes-sol", { stock: 2 }));
      sanity.failFetchFor.add("anillo-luna");

      const result = await apply([
        { handle: "anillo-luna", qty: 1 },
        { handle: "aretes-sol", qty: 1 },
      ]);

      expect(result.decremented).toEqual(["aretes-sol"]);
      expect(result.missing).toEqual([]);
      expect(result.failed).toEqual(["anillo-luna"]);
    });

    it("reports a transaction that fails as FAILED, writes nothing for it (no marker either), and still processes the rest", async () => {
      sanity = new FakeSanity(doc("anillo-luna", { stock: 2 }), doc("aretes-sol", { stock: 2 }));
      sanity.failTransactionFor.add("anillo-luna");

      const result = await apply([
        { handle: "anillo-luna", qty: 1 },
        { handle: "aretes-sol", qty: 1 },
      ]);

      expect(result.decremented).toEqual(["aretes-sol"]);
      expect(result.failed).toEqual(["anillo-luna"]);
      expect(sanity.docs.get("id-anillo-luna")?.stock).toBe(2);
      // No marker without its decrement: a retry must still be able to land.
      expect(sanity.markers.has(stockMoveId(SALE, "anillo-luna"))).toBe(false);
    });

    it("accounts for every handle in exactly one list, in the order asked", async () => {
      sanity = new FakeSanity(
        doc("a", { stock: 2 }),
        doc("c", { stock: 2 }),
        doc("d", { stock: 1 }),
      );
      sanity.failTransactionFor.add("c");

      const result = await apply([
        { handle: "a", qty: 1 },
        { handle: "b", qty: 1 },
        { handle: "c", qty: 1 },
        { handle: "d", qty: 5 },
      ]);

      expect(result).toEqual({
        decremented: ["a", "d"],
        missing: ["b"],
        failed: ["c"],
        oversold: ["d"],
        alreadyApplied: [],
      });
    });
  });

  describe("a quantity that is not a positive whole number", () => {
    it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 2])(
      "fails the handle (%j) without any call, instead of guessing one unit",
      async (qty) => {
        sanity = new FakeSanity(doc("anillo-luna", { stock: 5 }));

        const result = await apply([{ handle: "anillo-luna", qty }]);

        expect(result).toEqual({
          decremented: [],
          missing: [],
          failed: ["anillo-luna"],
          oversold: [],
          alreadyApplied: [],
        });
        expect(sanity.fetch).not.toHaveBeenCalled();
        expect(sanity.writes).toHaveLength(0);
        expect(sanity.markers.size).toBe(0);
      },
    );

    it("lets one bad line poison its own handle only, whatever the order", async () => {
      sanity = new FakeSanity(doc("anillo-luna", { stock: 5 }), doc("aretes-sol", { stock: 5 }));

      const result = await apply([
        { handle: "anillo-luna", qty: 2 },
        { handle: "anillo-luna", qty: 0 },
        { handle: "aretes-sol", qty: 1 },
      ]);

      expect(result.failed).toEqual(["anillo-luna"]);
      expect(result.decremented).toEqual(["aretes-sol"]);
      expect(sanity.docs.get("id-anillo-luna")?.stock).toBe(5);
    });
  });

  describe("without a usable write client", () => {
    it("fails EVERY handle, without fetching, when the client is unavailable (SANITY_WRITE_TOKEN unset)", async () => {
      getSanityWriteClientMock.mockReturnValue(undefined);

      const result = await apply([
        { handle: "anillo-luna", qty: 1 },
        { handle: "aretes-sol", qty: 2 },
      ]);

      // Never a silent no-op: these pieces are still on sale, and the caller must know.
      expect(result).toEqual({
        decremented: [],
        missing: [],
        failed: ["anillo-luna", "aretes-sol"],
        oversold: [],
        alreadyApplied: [],
      });
      expect(sanity.fetch).not.toHaveBeenCalled();
    });

    it("fails every handle, rather than throw, when the client cannot even be built", async () => {
      getSanityWriteClientMock.mockImplementation(() => {
        throw new Error("Invalid project id");
      });

      const result = await apply([{ handle: "anillo-luna", qty: 1 }]);

      expect(result.failed).toEqual(["anillo-luna"]);
    });

    it("returns an empty result for an empty list, without touching the write client", async () => {
      const result = await apply([]);

      expect(result).toEqual({
        decremented: [],
        missing: [],
        failed: [],
        oversold: [],
        alreadyApplied: [],
      });
      expect(getSanityWriteClientMock).not.toHaveBeenCalled();
    });
  });

  it("never exposes what went wrong: the result carries handles only", async () => {
    sanity = new FakeSanity(doc("anillo-luna", { stock: 2 }));
    sanity.transaction = () => {
      throw new Error("token sk-secret rejected");
    };

    const result = await apply([{ handle: "anillo-luna", qty: 1 }]);

    expect(result.failed).toEqual(["anillo-luna"]);
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("never throws and never logs, whatever fails", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
    sanity.fetch.mockRejectedValue(new Error("everything is down"));

    const result = await apply([
      { handle: "a", qty: 1 },
      { handle: "b", qty: 1 },
    ]);

    expect(result.failed).toEqual(["a", "b"]);

    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });
});

// Taking units off is not idempotent by nature, and a sale is delivered more
// than once (Stripe retries, a Dashboard resend, two deliveries at the same
// moment). What makes it safe is a marker document created in the SAME Sanity
// transaction as the decrement: the second attempt for the same sale is refused
// by Sanity itself.
describe("decrementStock: one decrement per (sale, piece)", () => {
  it("creates a private marker in the same transaction, with a deterministic id and the sale's details", async () => {
    sanity = new FakeSanity(doc("anillo-luna", { stock: 5 }));
    const before = Date.now();

    await apply([{ handle: "anillo-luna", qty: 2 }]);

    const id = `stockmove.${SALE}.${hashOf("anillo-luna")}`;
    expect(stockMoveId(SALE, "anillo-luna")).toBe(id);
    expect([...sanity.markers.keys()]).toEqual([id]);
    expect(sanity.markers.get(id)).toEqual({
      _id: id,
      _type: "stockMove",
      sessionId: SALE,
      handle: "anillo-luna",
      qty: 2,
      at: expect.any(String),
    });
    expect(Date.parse(sanity.markers.get(id)?.at ?? "")).toBeGreaterThanOrEqual(before);
  });

  it("builds ids Sanity accepts: only [A-Za-z0-9._-], with a dot so the document is not public", () => {
    const id = stockMoveId(SALE, "una pieza, con ñ; y * | = % símbolos");

    expect(id).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(id).toMatch(/^stockmove\.cs_test_a1B2c3D4\.[0-9a-f]{32}$/);
  });

  it("gives every handle its own marker and every sale its own", () => {
    expect(stockMoveId(SALE, "anillo")).not.toBe(stockMoveId(SALE, "aretes"));
    expect(stockMoveId("cs_test_one", "anillo")).not.toBe(stockMoveId("cs_test_two", "anillo"));
    expect(stockMoveId(SALE, "anillo")).toBe(stockMoveId(SALE, "anillo"));
  });

  it("a retry after a successful decrement does NOT decrement again", async () => {
    sanity = new FakeSanity(doc("anillo-luna", { stock: 5 }));

    const first = await apply([{ handle: "anillo-luna", qty: 2 }]);
    const retry = await apply([{ handle: "anillo-luna", qty: 2 }]);

    expect(sanity.docs.get("id-anillo-luna")?.stock).toBe(3);
    expect(first.alreadyApplied).toEqual([]);
    // A success for the caller, not a failure: the webhook answers 200.
    expect(retry).toEqual({
      decremented: ["anillo-luna"],
      missing: [],
      failed: [],
      oversold: [],
      alreadyApplied: ["anillo-luna"],
    });
    expect(sanity.markers.size).toBe(1);
  });

  it("a failure AFTER the decrement landed (the connection resets before the answer) does not double on the retry", async () => {
    sanity = new FakeSanity(doc("anillo-luna", { stock: 5 }));
    sanity.failAfterCommitFor.add("anillo-luna");

    const first = await apply([{ handle: "anillo-luna", qty: 2 }]);
    // The caller was told it failed, but Sanity applied it.
    expect(first.failed).toEqual(["anillo-luna"]);
    expect(sanity.docs.get("id-anillo-luna")?.stock).toBe(3);

    const retry = await apply([{ handle: "anillo-luna", qty: 2 }]);

    expect(retry.failed).toEqual([]);
    expect(retry.alreadyApplied).toEqual(["anillo-luna"]);
    expect(sanity.docs.get("id-anillo-luna")?.stock).toBe(3);
  });

  it("two concurrent applications of the same sale decrement ONCE", async () => {
    sanity = new FakeSanity(doc("anillo-luna", { stock: 5 }));

    const [a, b] = await Promise.all([
      apply([{ handle: "anillo-luna", qty: 2 }]),
      apply([{ handle: "anillo-luna", qty: 2 }]),
    ]);

    expect(sanity.docs.get("id-anillo-luna")?.stock).toBe(3);
    expect(sanity.markers.size).toBe(1);
    // Exactly one of them did the work; the other found it done. Neither failed.
    expect([a.alreadyApplied.length, b.alreadyApplied.length].sort()).toEqual([0, 1]);
    expect(a.failed).toEqual([]);
    expect(b.failed).toEqual([]);
    expect(a.decremented).toEqual(["anillo-luna"]);
    expect(b.decremented).toEqual(["anillo-luna"]);
  });

  it("a pre-existing sale (recorded before markers existed) is decremented ONCE, however often it is sent again", async () => {
    // A legacy product document and a sale with no marker anywhere.
    sanity = new FakeSanity(doc("anillo-luna", { stock: 4 }));
    expect(sanity.markers.size).toBe(0);

    await apply([{ handle: "anillo-luna", qty: 1 }]);
    await apply([{ handle: "anillo-luna", qty: 1 }]);
    await apply([{ handle: "anillo-luna", qty: 1 }]);

    expect(sanity.docs.get("id-anillo-luna")?.stock).toBe(3);
    expect(sanity.markers.size).toBe(1);
  });

  it("does not let one sale's marker block ANOTHER sale of the same piece", async () => {
    sanity = new FakeSanity(doc("anillo-luna", { stock: 5 }));

    await apply([{ handle: "anillo-luna", qty: 1 }], "cs_test_one");
    const second = await apply([{ handle: "anillo-luna", qty: 2 }], "cs_test_two");

    expect(sanity.docs.get("id-anillo-luna")?.stock).toBe(2);
    expect(second.alreadyApplied).toEqual([]);
    expect(sanity.markers.size).toBe(2);
  });

  it("after a PARTIAL failure, a retry lands only the piece that did not land", async () => {
    sanity = new FakeSanity(doc("uno", { stock: 5 }), doc("dos", { stock: 5 }));
    sanity.failTransactionFor.add("dos");

    const first = await apply([
      { handle: "uno", qty: 2 },
      { handle: "dos", qty: 1 },
    ]);
    expect(first.decremented).toEqual(["uno"]);
    expect(first.failed).toEqual(["dos"]);

    sanity.failTransactionFor.clear();
    const retry = await apply([
      { handle: "uno", qty: 2 },
      { handle: "dos", qty: 1 },
    ]);

    expect(retry.decremented).toEqual(["uno", "dos"]);
    expect(retry.alreadyApplied).toEqual(["uno"]);
    expect(retry.failed).toEqual([]);
    expect(sanity.stockOf("uno")).toBe(3);
    expect(sanity.stockOf("dos")).toBe(4);
  });

  it("does not report an oversell a second time for a sale it already applied", async () => {
    sanity = new FakeSanity(doc("anillo-luna", { stock: 1 }));

    const first = await apply([{ handle: "anillo-luna", qty: 3 }]);
    const retry = await apply([{ handle: "anillo-luna", qty: 3 }]);

    expect(first.oversold).toEqual(["anillo-luna"]);
    expect(retry.oversold).toEqual([]);
    expect(sanity.docs.get("id-anillo-luna")?.stock).toBe(0);
  });

  it.each([
    ["a 409 status", Object.assign(new Error("conflict"), { statusCode: 409 })],
    [
      "a 409 on the response",
      Object.assign(new Error("Mutation failed"), { response: { statusCode: 409 } }),
    ],
    ["the 'already exists' wording", new Error('Document by ID "x" already exists')],
    ["the typed conflict the SDK raises", new ConflictError("anything")],
  ])("reads %s as 'already applied', not as a failure", async (_label, error) => {
    sanity = new FakeSanity(doc("anillo-luna", { stock: 5 }));
    sanity.transaction = () => {
      throw error;
    };

    const result = await apply([{ handle: "anillo-luna", qty: 1 }]);

    expect(result.alreadyApplied).toEqual(["anillo-luna"]);
    expect(result.failed).toEqual([]);
  });

  it.each([
    ["a 500", Object.assign(new Error("boom"), { statusCode: 500 })],
    ["a 401", Object.assign(new Error("Unauthorized"), { statusCode: 401 })],
    ["a plain network error", new Error("fetch failed")],
    ["a non-error", "oops"],
  ])("still reads %s as a failure", async (_label, error) => {
    sanity = new FakeSanity(doc("anillo-luna", { stock: 5 }));
    sanity.transaction = () => {
      throw error;
    };

    const result = await apply([{ handle: "anillo-luna", qty: 1 }]);

    expect(result.failed).toEqual(["anillo-luna"]);
    expect(result.alreadyApplied).toEqual([]);
  });

  describe("a source id that cannot make a safe marker", () => {
    it.each(["", "a.b", "a/b", "a b", "x".repeat(121), "ñandú", "cs_test_1\n"])(
      "fails every handle (%j) without touching Sanity, instead of decrementing with no marker",
      async (source) => {
        sanity = new FakeSanity(doc("anillo-luna", { stock: 5 }));

        const result = await apply([{ handle: "anillo-luna", qty: 1 }], source);

        expect(result.failed).toEqual(["anillo-luna"]);
        expect(sanity.fetch).not.toHaveBeenCalled();
        expect(sanity.docs.get("id-anillo-luna")?.stock).toBe(5);
      },
    );

    it("accepts a Stripe session id and an auto-generated Firestore id", async () => {
      sanity = new FakeSanity(doc("anillo-luna", { stock: 5 }));

      const stripe = await apply([{ handle: "anillo-luna", qty: 1 }], "cs_live_a1B2c3D4e5F6");
      const manual = await apply([{ handle: "anillo-luna", qty: 1 }], "Zk3jQ8vYhT1aPq0mWx9L");

      expect(stripe.failed).toEqual([]);
      expect(manual.failed).toEqual([]);
      expect(sanity.docs.get("id-anillo-luna")?.stock).toBe(3);
    });
  });
});

// A piece in Studio has a published document AND, while it is being edited, a
// draft (`drafts.<id>`) with the same slug. The stock must be lowered on the
// published one: a draft decrement would leave the real count untouched.
describe("decrementStock: drafts", () => {
  it("excludes drafts in the lookup query itself, whatever the client's perspective", () => {
    expect(PRODUCT_STOCK_BY_HANDLE_QUERY).toContain(DRAFT_FILTER);
    expect(PRODUCT_STOCK_BY_HANDLE_QUERY).toContain("slug.current == $handle");
  });

  it("decrements the PUBLISHED document when a draft with the same slug exists", async () => {
    const draft: StoredDoc = {
      _id: "drafts.id-anillo-luna",
      slug: "anillo-luna",
      status: "available",
      stock: 9,
    };
    // The draft is listed first, so a lookup that ignored the filter would pick it.
    sanity = new FakeSanity(draft, doc("anillo-luna", { stock: 5 }));

    const result = await apply([{ handle: "anillo-luna", qty: 2 }]);

    expect(result.decremented).toEqual(["anillo-luna"]);
    expect(sanity.docs.get("id-anillo-luna")?.stock).toBe(3);
    expect(sanity.docs.get("drafts.id-anillo-luna")?.stock).toBe(9);
    expect(sanity.writes.every((write) => !write.id.startsWith("drafts."))).toBe(true);
  });

  it("reports a piece that exists ONLY as a draft as missing: nothing published to lower", async () => {
    sanity = new FakeSanity({
      _id: "drafts.id-nueva",
      slug: "nueva",
      status: "available",
      stock: 3,
    });

    const result = await apply([{ handle: "nueva", qty: 1 }]);

    expect(result.missing).toEqual(["nueva"]);
    expect(sanity.writes).toHaveLength(0);
    expect(sanity.markers.size).toBe(0);
    expect(sanity.docs.get("drafts.id-nueva")?.stock).toBe(3);
  });
});
