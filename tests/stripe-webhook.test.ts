import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// getStripeClient, decrementStock and the sale ledger (recordStripeSale and the
// two stock-progress helpers) are all mocked so this file tests exactly the
// route handler's own branching (signature gate -> event-type dispatch ->
// payment gate -> record the sale -> take the units off the stock once ->
// save the progress -> status code), decoupled from the real Stripe SDK's HMAC
// verification, the real Sanity write path and the real sales ledger — those
// are each other modules' own concerns (see tests/decrement-stock.test.ts,
// tests/stripe-sale-recording.test.ts and, with everything wired together,
// tests/stripe-webhook-sales.test.ts).
const getStripeClientMock = vi.fn();
const constructEventMock = vi.fn();
const decrementStockMock = vi.fn();
const recordStripeSaleMock = vi.fn();
const readStripeSaleStockMock = vi.fn();
const saveStripeSaleStockMock = vi.fn();

vi.mock("@/lib/commerce/stripe/client", () => ({
  getStripeClient: () => getStripeClientMock(),
}));

vi.mock("@/lib/commerce/sanity/stock", () => ({
  decrementStock: (...args: unknown[]) => decrementStockMock(...args),
}));

vi.mock("@/lib/admin/data/stripe-sales", () => ({
  recordStripeSale: (...args: unknown[]) => recordStripeSaleMock(...args),
  readStripeSaleStock: (...args: unknown[]) => readStripeSaleStockMock(...args),
  saveStripeSaleStock: (...args: unknown[]) => saveStripeSaleStockMock(...args),
}));

// A Route Handler cannot use updateTag (Server Actions only): the webhook
// expires the catalog with revalidateTag(tag, { expire: 0 }). Mocked because
// the real one needs a live Next request context.
const revalidateTagMock = vi.fn();
vi.mock("next/cache", () => ({
  revalidateTag: (...args: unknown[]) => revalidateTagMock(...args),
}));

import { POST } from "@/app/api/stripe/webhook/route";

const ORIGINAL_ENV = { ...process.env };

const NOTHING_FAILED = {
  decremented: ["anillo-plata"],
  missing: [],
  failed: [],
  oversold: [],
};

function makeRequest(body: string, headers: Record<string, string> = {}): Request {
  return new Request("https://nerea.example/api/stripe/webhook", {
    method: "POST",
    headers,
    body,
  });
}

// A Checkout Session as the route sees it. Paid by default: that is the one
// state in which anything may be sold.
function session(overrides: Record<string, unknown> = {}) {
  return {
    id: "cs_test_1",
    payment_status: "paid",
    metadata: { handles: "anillo-plata" },
    customer_details: { email: "buyer@example.com" },
    ...overrides,
  };
}

function eventOf(type: string, object: unknown) {
  constructEventMock.mockReturnValue({ type, data: { object } });
}

function deliver() {
  return POST(makeRequest("{}", { "stripe-signature": "sig_test" }));
}

beforeEach(() => {
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_secret";
  getStripeClientMock.mockReturnValue({
    webhooks: { constructEvent: constructEventMock },
  });
  decrementStockMock.mockResolvedValue(NOTHING_FAILED);
  recordStripeSaleMock.mockResolvedValue("recorded");
  readStripeSaleStockMock.mockResolvedValue({ applied: false });
  saveStripeSaleStockMock.mockResolvedValue(undefined);
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  // Resets implementations and queued "once" values too, so nothing leaks from
  // one test into the next; the console spies of the failure tests go with it.
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

describe("POST /api/stripe/webhook — signature gate", () => {
  it("returns 400 and never touches the stock when the stripe-signature header is missing", async () => {
    const response = await POST(makeRequest("{}"));

    expect(response.status).toBe(400);
    expect(constructEventMock).not.toHaveBeenCalled();
    expect(decrementStockMock).not.toHaveBeenCalled();
    expect(recordStripeSaleMock).not.toHaveBeenCalled();
  });

  it("returns 400 and never processes when STRIPE_WEBHOOK_SECRET is unset", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;

    const response = await POST(
      makeRequest("{}", { "stripe-signature": "sig_test" }),
    );

    expect(response.status).toBe(400);
    expect(constructEventMock).not.toHaveBeenCalled();
    expect(decrementStockMock).not.toHaveBeenCalled();
    expect(recordStripeSaleMock).not.toHaveBeenCalled();
  });

  it("returns 400 and never touches the stock when Stripe is not configured", async () => {
    getStripeClientMock.mockReturnValueOnce(undefined);

    const response = await POST(
      makeRequest("{}", { "stripe-signature": "sig_test" }),
    );

    expect(response.status).toBe(400);
    expect(decrementStockMock).not.toHaveBeenCalled();
    expect(recordStripeSaleMock).not.toHaveBeenCalled();
  });

  it("returns 400 and never touches the stock when signature verification throws", async () => {
    constructEventMock.mockImplementation(() => {
      throw new Error(
        "No signatures found matching the expected signature for payload",
      );
    });

    const response = await POST(
      makeRequest("{}", { "stripe-signature": "bad_sig" }),
    );

    expect(response.status).toBe(400);
    expect(decrementStockMock).not.toHaveBeenCalled();
    expect(recordStripeSaleMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/stripe/webhook — pay before sell: checkout.session.completed", () => {
  it("processes a PAID legacy session (handles only): one unit of each, records the sale, answers 200", async () => {
    eventOf(
      "checkout.session.completed",
      session({ metadata: { handles: "anillo-plata,aretes-luna" } }),
    );

    const response = await deliver();

    expect(response.status).toBe(200);
    expect(decrementStockMock).toHaveBeenCalledWith([
      { handle: "anillo-plata", qty: 1 },
      { handle: "aretes-luna", qty: 1 },
    ], "cs_test_1");
    expect(recordStripeSaleMock).toHaveBeenCalledTimes(1);
  });

  it("takes the QUANTITIES in metadata.items off the stock, preferring them to metadata.handles", async () => {
    eventOf(
      "checkout.session.completed",
      session({
        metadata: {
          handles: "anillo-plata,aretes-luna",
          items: "anillo-plata*3|size=7;aretes-luna*1",
        },
      }),
    );

    const response = await deliver();

    expect(response.status).toBe(200);
    expect(decrementStockMock).toHaveBeenCalledWith([
      { handle: "anillo-plata", qty: 3 },
      { handle: "aretes-luna", qty: 1 },
    ], "cs_test_1");
  });

  it("adds up the lines of one design (two sizes) into ONE decrement", async () => {
    eventOf(
      "checkout.session.completed",
      session({
        metadata: {
          handles: "anillo-plata",
          items: "anillo-plata*2|size=6;anillo-plata*1|size=7",
        },
      }),
    );

    await deliver();

    expect(decrementStockMock).toHaveBeenCalledWith([
      { handle: "anillo-plata", qty: 3 },
    ], "cs_test_1");
  });

  // `handles` is a COMMA list, and a slug typed by hand in Studio could hold a
  // comma: read next to `items`, it could invent pieces that were never sold.
  it("never consults metadata.handles when metadata.items is present, even for a handle items does not name", async () => {
    eventOf(
      "checkout.session.completed",
      session({
        metadata: { handles: "anillo-plata,aretes-luna", items: "anillo-plata*2" },
      }),
    );

    await deliver();

    expect(decrementStockMock).toHaveBeenCalledWith(
      [{ handle: "anillo-plata", qty: 2 }],
      "cs_test_1",
    );
  });

  it("does not split a slug that holds a comma: the items value names it whole", async () => {
    eventOf(
      "checkout.session.completed",
      session({
        // Escaped in items; split in half by the legacy comma list.
        metadata: { handles: "rara,pieza", items: "rara%2Cpieza*1" },
      }),
    );

    await deliver();

    expect(decrementStockMock).toHaveBeenCalledWith(
      [{ handle: "rara,pieza", qty: 1 }],
      "cs_test_1",
    );
  });

  it.each(["unpaid", "no_payment_required"])(
    "does NOTHING for a completed session that is %s: answers 200, takes nothing off, records nothing",
    async (paymentStatus) => {
      eventOf("checkout.session.completed", session({ payment_status: paymentStatus }));

      const response = await deliver();

      expect(response.status).toBe(200);
      expect(decrementStockMock).not.toHaveBeenCalled();
      expect(recordStripeSaleMock).not.toHaveBeenCalled();
    },
  );

  it("does nothing when the session carries no payment status at all (fails closed)", async () => {
    eventOf("checkout.session.completed", session({ payment_status: undefined }));

    const response = await deliver();

    expect(response.status).toBe(200);
    expect(decrementStockMock).not.toHaveBeenCalled();
    expect(recordStripeSaleMock).not.toHaveBeenCalled();
  });

  it("asks for an empty decrement when the session names no pieces at all", async () => {
    eventOf("checkout.session.completed", session({ metadata: null }));

    const response = await deliver();

    expect(response.status).toBe(200);
    expect(decrementStockMock).toHaveBeenCalledWith([], "cs_test_1");
  });
});

describe("POST /api/stripe/webhook — pay before sell: delayed payments", () => {
  it("processes checkout.session.async_payment_succeeded exactly like a paid completion", async () => {
    eventOf(
      "checkout.session.async_payment_succeeded",
      session({ metadata: { handles: "anillo-plata,aretes-luna" } }),
    );

    const response = await deliver();

    expect(response.status).toBe(200);
    expect(decrementStockMock).toHaveBeenCalledWith([
      { handle: "anillo-plata", qty: 1 },
      { handle: "aretes-luna", qty: 1 },
    ], "cs_test_1");
    expect(recordStripeSaleMock).toHaveBeenCalledTimes(1);
  });

  it("still requires the session to be paid on async_payment_succeeded: one rule for everything", async () => {
    eventOf(
      "checkout.session.async_payment_succeeded",
      session({ payment_status: "unpaid" }),
    );

    const response = await deliver();

    expect(response.status).toBe(200);
    expect(decrementStockMock).not.toHaveBeenCalled();
    expect(recordStripeSaleMock).not.toHaveBeenCalled();
  });

  it("does NOTHING for checkout.session.async_payment_failed: nothing was paid, nothing is sold", async () => {
    eventOf(
      "checkout.session.async_payment_failed",
      session({ payment_status: "unpaid" }),
    );

    const response = await deliver();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(decrementStockMock).not.toHaveBeenCalled();
    expect(recordStripeSaleMock).not.toHaveBeenCalled();
  });

  it("does nothing for async_payment_failed even if the session claims to be paid", async () => {
    eventOf("checkout.session.async_payment_failed", session());

    const response = await deliver();

    expect(response.status).toBe(200);
    expect(decrementStockMock).not.toHaveBeenCalled();
    expect(recordStripeSaleMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/stripe/webhook — a paid session: recording, stock and retries", () => {
  const paid = session();

  beforeEach(() => {
    eventOf("checkout.session.completed", paid);
  });

  it("records the sale of the verified session BEFORE taking the units off the stock", async () => {
    const response = await deliver();

    expect(response.status).toBe(200);
    expect(recordStripeSaleMock).toHaveBeenCalledTimes(1);
    expect(recordStripeSaleMock).toHaveBeenCalledWith(paid);
    expect(recordStripeSaleMock.mock.invocationCallOrder[0]).toBeLessThan(
      decrementStockMock.mock.invocationCallOrder[0],
    );
  });

  it("marks the sale as applied once every unit is off, so a redelivery cannot take them off again", async () => {
    await deliver();

    expect(saveStripeSaleStockMock).toHaveBeenCalledTimes(1);
    expect(saveStripeSaleStockMock).toHaveBeenCalledWith("cs_test_1", {
      applied: true,
      oversold: false,
    });
    expect(decrementStockMock.mock.invocationCallOrder[0]).toBeLessThan(
      saveStripeSaleStockMock.mock.invocationCallOrder[0],
    );
  });

  it("keys the decrement on the Checkout Session id, so Sanity can refuse a second one for the same sale", async () => {
    await deliver();

    expect(decrementStockMock).toHaveBeenCalledTimes(1);
    expect(decrementStockMock.mock.calls[0][1]).toBe("cs_test_1");
  });

  it("answers 200 when every piece was already applied by an earlier delivery (Sanity's markers said so)", async () => {
    decrementStockMock.mockResolvedValue({
      decremented: ["anillo-plata"],
      missing: [],
      failed: [],
      oversold: [],
      alreadyApplied: ["anillo-plata"],
    });

    const response = await deliver();

    expect(response.status).toBe(200);
    expect(saveStripeSaleStockMock).toHaveBeenCalledWith("cs_test_1", {
      applied: true,
      oversold: false,
    });
  });

  it("does not read the stock progress for a sale it has just created", async () => {
    await deliver();

    expect(readStripeSaleStockMock).not.toHaveBeenCalled();
  });

  it("answers 500 when a piece's stock could not be updated, so Stripe retries — keeping the sale, saving what landed", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    eventOf("checkout.session.completed", session({ metadata: { handles: "a,b" } }));
    decrementStockMock.mockResolvedValue({
      decremented: ["a"],
      missing: [],
      failed: ["b"],
      oversold: [],
    });

    const response = await deliver();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "stock not updated" });
    // The retry takes only the pieces that did not land.
    expect(saveStripeSaleStockMock).toHaveBeenCalledWith("cs_test_1", {
      applied: false,
      oversold: false,
    });
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(
      "[stripe] Stock could not be updated; answering 500 so Stripe retries.",
    );
  });

  it("answers 500 when EVERY piece failed (a missing Sanity write token), without marking the sale applied", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    decrementStockMock.mockResolvedValue({
      decremented: [],
      missing: [],
      failed: ["anillo-plata"],
      oversold: [],
    });

    const response = await deliver();

    expect(response.status).toBe(500);
    expect(saveStripeSaleStockMock).toHaveBeenCalledWith("cs_test_1", {
      applied: false,
      oversold: false,
    });
  });

  it("does NOT treat a product that no longer exists as a failure: a retry could not change it", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    decrementStockMock.mockResolvedValue({
      decremented: [],
      missing: ["anillo-plata"],
      failed: [],
      oversold: [],
    });

    const response = await deliver();

    expect(response.status).toBe(200);
    expect(recordStripeSaleMock).toHaveBeenCalledTimes(1);
    expect(saveStripeSaleStockMock).toHaveBeenCalledWith("cs_test_1", {
      applied: true,
      oversold: false,
    });
    expect(error).not.toHaveBeenCalled();
  });

  it("flags the sale oversold, and still answers 200, when more units were sold than the shop had", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    decrementStockMock.mockResolvedValue({
      decremented: ["anillo-plata"],
      missing: [],
      failed: [],
      oversold: ["anillo-plata"],
    });

    const response = await deliver();

    // The money has arrived and the stock is clamped: a retry fixes nothing.
    expect(response.status).toBe(200);
    expect(saveStripeSaleStockMock).toHaveBeenCalledWith("cs_test_1", {
      applied: true,
      oversold: true,
    });
    expect(error).not.toHaveBeenCalled();
  });

  it("answers 500 when the sale cannot be recorded, and takes NOTHING off the stock yet", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    recordStripeSaleMock.mockRejectedValueOnce(new Error("4 DEADLINE_EXCEEDED"));

    const response = await deliver();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "sale not recorded" });
    // The sale document is the idempotency token: without it, a retry could not
    // tell whether the units were already taken off.
    expect(decrementStockMock).not.toHaveBeenCalled();
    expect(saveStripeSaleStockMock).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      "[stripe] Sale could not be recorded; answering 500 so Stripe retries.",
    );
  });

  it("answers 500 — not a quiet 200 — when Firestore is not configured, so the sale is not silently lost", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    recordStripeSaleMock.mockResolvedValue("unconfigured");

    const response = await deliver();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "sale ledger not configured" });
    expect(decrementStockMock).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(
      "[stripe] Sale not recorded: Firestore is not configured; answering 500 so Stripe retries.",
    );
  });

  it("answers 200 quietly, taking nothing off, for a session that is not one of this storefront's sales", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    recordStripeSaleMock.mockResolvedValueOnce("skipped");

    const response = await deliver();

    expect(response.status).toBe(200);
    expect(decrementStockMock).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("answers 500 when the progress cannot be saved after the units were taken off, with a fixed line", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    saveStripeSaleStockMock.mockRejectedValueOnce(
      new Error("detail sales/stripe_cs_test_1 buyer@example.com"),
    );

    const response = await deliver();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "stock progress not saved" });
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(
      "[stripe] Stock progress could not be saved; answering 500 so Stripe retries.",
    );
    expect(JSON.stringify(error.mock.calls)).not.toContain("buyer@example.com");
  });

  it("logs only fixed lines, never the session, a handle or the error", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    decrementStockMock.mockResolvedValue({
      decremented: [],
      missing: [],
      failed: ["anillo-plata"],
      oversold: [],
    });
    saveStripeSaleStockMock.mockRejectedValueOnce(new Error("detail buyer@example.com"));

    await deliver();

    const logged = JSON.stringify(error.mock.calls);
    expect(logged).not.toContain("buyer@example.com");
    expect(logged).not.toContain("anillo-plata");
    expect(logged).not.toContain("cs_test_1");
  });
});

// Stripe redelivers an event until it gets a 200, and taking units off the stock
// is not idempotent, so a redelivery must never take them off a second time.
describe("POST /api/stripe/webhook — idempotent redelivery", () => {
  beforeEach(() => {
    eventOf(
      "checkout.session.completed",
      session({ metadata: { handles: "a,b", items: "a*2;b*1" } }),
    );
    recordStripeSaleMock.mockResolvedValue("duplicate");
  });

  it("does NOT take the units off again when the sale is already marked applied", async () => {
    readStripeSaleStockMock.mockResolvedValue({ applied: true });

    const response = await deliver();

    expect(response.status).toBe(200);
    expect(readStripeSaleStockMock).toHaveBeenCalledWith("cs_test_1");
    expect(decrementStockMock).not.toHaveBeenCalled();
    expect(saveStripeSaleStockMock).not.toHaveBeenCalled();
    expect(revalidateTagMock).not.toHaveBeenCalled();
  });

  it("takes the units off when the sale exists but the earlier delivery never finished (no marker)", async () => {
    decrementStockMock.mockResolvedValue({
      decremented: ["a", "b"],
      missing: [],
      failed: [],
      oversold: [],
    });

    const response = await deliver();

    expect(response.status).toBe(200);
    expect(decrementStockMock).toHaveBeenCalledWith([
      { handle: "a", qty: 2 },
      { handle: "b", qty: 1 },
    ], "cs_test_1");
    expect(saveStripeSaleStockMock).toHaveBeenCalledWith("cs_test_1", {
      applied: true,
      oversold: false,
    });
  });

  it("asks for EVERY piece again after a partial failure: Sanity's markers skip the ones that landed", async () => {
    readStripeSaleStockMock.mockResolvedValue({ applied: false });
    decrementStockMock.mockResolvedValue({
      decremented: ["a", "b"],
      missing: [],
      failed: [],
      oversold: [],
      alreadyApplied: ["a"],
    });

    const response = await deliver();

    expect(response.status).toBe(200);
    expect(decrementStockMock).toHaveBeenCalledWith(
      [
        { handle: "a", qty: 2 },
        { handle: "b", qty: 1 },
      ],
      "cs_test_1",
    );
    expect(saveStripeSaleStockMock).toHaveBeenCalledWith("cs_test_1", {
      applied: true,
      oversold: false,
    });
  });

  it("treats a duplicate whose sale cannot be found as 'nothing applied yet'", async () => {
    readStripeSaleStockMock.mockResolvedValue(null);

    await deliver();

    expect(decrementStockMock).toHaveBeenCalledTimes(1);
  });

  it("still asks Sanity when the sale's progress cannot be read: the markers make asking again harmless", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    readStripeSaleStockMock.mockRejectedValueOnce(new Error("14 UNAVAILABLE"));

    const response = await deliver();

    expect(response.status).toBe(200);
    expect(decrementStockMock).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
  });

  it("delivered twice in a row, takes the units off exactly once", async () => {
    // A tiny in-memory ledger standing in for the sale document.
    let stored: { applied: boolean } | null = null;
    recordStripeSaleMock.mockImplementation(async () => {
      if (stored === null) {
        stored = { applied: false };
        return "recorded";
      }
      return "duplicate";
    });
    readStripeSaleStockMock.mockImplementation(async () => stored);
    saveStripeSaleStockMock.mockImplementation(
      async (_id: string, progress: { applied: boolean; done: string[] }) => {
        stored = { applied: progress.applied };
      },
    );
    decrementStockMock.mockResolvedValue({
      decremented: ["a", "b"],
      missing: [],
      failed: [],
      oversold: [],
    });

    const first = await deliver();
    const second = await deliver();

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(decrementStockMock).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/stripe/webhook — expiring the cached catalog", () => {
  it("expires the products tag immediately, after the units were taken off", async () => {
    eventOf("checkout.session.completed", session());

    const response = await deliver();

    expect(response.status).toBe(200);
    expect(revalidateTagMock).toHaveBeenCalledTimes(1);
    // { expire: 0 }: the next request is a blocking miss, never a stale hit
    // that would keep showing the sold-out piece as available.
    expect(revalidateTagMock).toHaveBeenCalledWith("products", { expire: 0 });
    expect(decrementStockMock.mock.invocationCallOrder[0]).toBeLessThan(
      revalidateTagMock.mock.invocationCallOrder[0],
    );
  });

  it("expires it for async_payment_succeeded too", async () => {
    eventOf("checkout.session.async_payment_succeeded", session());

    await deliver();

    expect(revalidateTagMock).toHaveBeenCalledWith("products", { expire: 0 });
  });

  it("still expires it, once, when only some of the pieces were updated (the 500 stays)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    eventOf("checkout.session.completed", session({ metadata: { handles: "a,b,c" } }));
    decrementStockMock.mockResolvedValue({
      decremented: ["a", "c"],
      missing: [],
      failed: ["b"],
      oversold: [],
    });

    const response = await deliver();

    expect(response.status).toBe(500);
    expect(revalidateTagMock).toHaveBeenCalledTimes(1);
    expect(revalidateTagMock).toHaveBeenCalledWith("products", { expire: 0 });
  });

  it.each([
    [
      "every piece failed",
      { decremented: [], missing: [], failed: ["anillo-plata"], oversold: [] },
    ],
    [
      "the product no longer exists",
      { decremented: [], missing: ["anillo-plata"], failed: [], oversold: [] },
    ],
  ])("does not expire anything when %s: nothing left the shelf", async (_label, outcome) => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    eventOf("checkout.session.completed", session());
    decrementStockMock.mockResolvedValue(outcome);

    await deliver();

    expect(revalidateTagMock).not.toHaveBeenCalled();
  });

  it("does not expire anything for an unpaid session, an unrelated event or a bad signature", async () => {
    eventOf("checkout.session.completed", session({ payment_status: "unpaid" }));
    await deliver();

    eventOf("payment_intent.succeeded", {});
    await deliver();

    constructEventMock.mockImplementation(() => {
      throw new Error("No signatures found matching the expected signature for payload");
    });
    await POST(makeRequest("{}", { "stripe-signature": "bad_sig" }));

    expect(revalidateTagMock).not.toHaveBeenCalled();
  });

  it("never fails the delivery when the cache cannot be expired: a paid order is not worth a redelivery", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    eventOf("checkout.session.completed", session());
    revalidateTagMock.mockImplementation(() => {
      throw new Error("Invariant: static generation store missing in revalidateTag products");
    });

    const response = await deliver();

    expect(response.status).toBe(200);
    expect(recordStripeSaleMock).toHaveBeenCalledTimes(1);
    // One fixed line: nothing of the error, the handle or the session is logged.
    expect(error).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(error.mock.calls);
    expect(logged).not.toContain("Invariant");
    expect(logged).not.toContain("anillo-plata");
    expect(logged).not.toContain("cs_test_1");
  });
});

describe("POST /api/stripe/webhook — unrelated event types", () => {
  it("returns 200 and never writes for an event type this endpoint doesn't handle", async () => {
    eventOf("payment_intent.succeeded", {});

    const response = await deliver();

    expect(response.status).toBe(200);
    expect(decrementStockMock).not.toHaveBeenCalled();
    expect(recordStripeSaleMock).not.toHaveBeenCalled();
  });
});
