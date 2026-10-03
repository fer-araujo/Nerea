import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// getStripeClient, markProductsSold and recordStripeSale are all mocked so
// this file tests exactly the route handler's own branching (signature gate
// -> event-type dispatch -> payment gate -> markProductsSold ->
// recordStripeSale -> status code), decoupled from the real Stripe SDK's HMAC
// verification, the real Sanity write path and the real sales ledger — those
// are each other modules' own concerns (see tests/mark-sold.test.ts,
// tests/stripe-sale-recording.test.ts and, with everything wired together,
// tests/stripe-webhook-sales.test.ts).
const getStripeClientMock = vi.fn();
const constructEventMock = vi.fn();
const markProductsSoldMock = vi.fn();
const recordStripeSaleMock = vi.fn();

vi.mock("@/lib/commerce/stripe/client", () => ({
  getStripeClient: () => getStripeClientMock(),
}));

vi.mock("@/lib/commerce/sanity/mark-sold", () => ({
  markProductsSold: (...args: unknown[]) => markProductsSoldMock(...args),
}));

vi.mock("@/lib/admin/data/stripe-sales", () => ({
  recordStripeSale: (...args: unknown[]) => recordStripeSaleMock(...args),
}));

import { POST } from "@/app/api/stripe/webhook/route";

const ORIGINAL_ENV = { ...process.env };

const NOTHING_FAILED = { marked: ["anillo-plata"], missing: [], failed: [] };

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
  markProductsSoldMock.mockResolvedValue(NOTHING_FAILED);
  recordStripeSaleMock.mockResolvedValue("recorded");
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  // Resets implementations and queued "once" values too, so nothing leaks from
  // one test into the next; the console spies of the failure tests go with it.
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

describe("POST /api/stripe/webhook — signature gate", () => {
  it("returns 400 and never calls markProductsSold when the stripe-signature header is missing", async () => {
    const response = await POST(makeRequest("{}"));

    expect(response.status).toBe(400);
    expect(constructEventMock).not.toHaveBeenCalled();
    expect(markProductsSoldMock).not.toHaveBeenCalled();
    expect(recordStripeSaleMock).not.toHaveBeenCalled();
  });

  it("returns 400 and never processes when STRIPE_WEBHOOK_SECRET is unset", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;

    const response = await POST(
      makeRequest("{}", { "stripe-signature": "sig_test" }),
    );

    expect(response.status).toBe(400);
    expect(constructEventMock).not.toHaveBeenCalled();
    expect(markProductsSoldMock).not.toHaveBeenCalled();
    expect(recordStripeSaleMock).not.toHaveBeenCalled();
  });

  it("returns 400 and never calls markProductsSold when Stripe is not configured", async () => {
    getStripeClientMock.mockReturnValueOnce(undefined);

    const response = await POST(
      makeRequest("{}", { "stripe-signature": "sig_test" }),
    );

    expect(response.status).toBe(400);
    expect(markProductsSoldMock).not.toHaveBeenCalled();
    expect(recordStripeSaleMock).not.toHaveBeenCalled();
  });

  it("returns 400 and never calls markProductsSold when signature verification throws", async () => {
    constructEventMock.mockImplementation(() => {
      throw new Error(
        "No signatures found matching the expected signature for payload",
      );
    });

    const response = await POST(
      makeRequest("{}", { "stripe-signature": "bad_sig" }),
    );

    expect(response.status).toBe(400);
    expect(markProductsSoldMock).not.toHaveBeenCalled();
    expect(recordStripeSaleMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/stripe/webhook — pay before sell: checkout.session.completed", () => {
  it("processes a PAID session: marks every comma-joined handle sold, records the sale, answers 200", async () => {
    eventOf(
      "checkout.session.completed",
      session({ metadata: { handles: "anillo-plata,aretes-luna" } }),
    );

    const response = await deliver();

    expect(response.status).toBe(200);
    expect(markProductsSoldMock).toHaveBeenCalledWith(["anillo-plata", "aretes-luna"]);
    expect(recordStripeSaleMock).toHaveBeenCalledTimes(1);
  });

  it.each(["unpaid", "no_payment_required"])(
    "does NOTHING for a completed session that is %s: answers 200, marks nothing, records nothing",
    async (paymentStatus) => {
      eventOf("checkout.session.completed", session({ payment_status: paymentStatus }));

      const response = await deliver();

      expect(response.status).toBe(200);
      expect(markProductsSoldMock).not.toHaveBeenCalled();
      expect(recordStripeSaleMock).not.toHaveBeenCalled();
    },
  );

  it("does nothing when the session carries no payment status at all (fails closed)", async () => {
    eventOf("checkout.session.completed", session({ payment_status: undefined }));

    const response = await deliver();

    expect(response.status).toBe(200);
    expect(markProductsSoldMock).not.toHaveBeenCalled();
    expect(recordStripeSaleMock).not.toHaveBeenCalled();
  });

  it("calls markProductsSold with an empty array when metadata.handles is missing", async () => {
    eventOf("checkout.session.completed", session({ metadata: null }));

    const response = await deliver();

    expect(response.status).toBe(200);
    expect(markProductsSoldMock).toHaveBeenCalledWith([]);
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
    expect(markProductsSoldMock).toHaveBeenCalledWith(["anillo-plata", "aretes-luna"]);
    expect(recordStripeSaleMock).toHaveBeenCalledTimes(1);
  });

  it("still requires the session to be paid on async_payment_succeeded: one rule for everything", async () => {
    eventOf(
      "checkout.session.async_payment_succeeded",
      session({ payment_status: "unpaid" }),
    );

    const response = await deliver();

    expect(response.status).toBe(200);
    expect(markProductsSoldMock).not.toHaveBeenCalled();
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
    expect(markProductsSoldMock).not.toHaveBeenCalled();
    expect(recordStripeSaleMock).not.toHaveBeenCalled();
  });

  it("does nothing for async_payment_failed even if the session claims to be paid", async () => {
    eventOf("checkout.session.async_payment_failed", session());

    const response = await deliver();

    expect(response.status).toBe(200);
    expect(markProductsSoldMock).not.toHaveBeenCalled();
    expect(recordStripeSaleMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/stripe/webhook — a paid session: recording and retries", () => {
  const paid = session();

  beforeEach(() => {
    eventOf("checkout.session.completed", paid);
  });

  it("records the sale of the verified session AFTER marking the piece sold", async () => {
    const response = await deliver();

    expect(response.status).toBe(200);
    expect(recordStripeSaleMock).toHaveBeenCalledTimes(1);
    expect(recordStripeSaleMock).toHaveBeenCalledWith(paid);
    expect(markProductsSoldMock.mock.invocationCallOrder[0]).toBeLessThan(
      recordStripeSaleMock.mock.invocationCallOrder[0],
    );
  });

  it("answers 500 when a piece could not be marked sold, so Stripe retries — and still records the sale", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    markProductsSoldMock.mockResolvedValue({ marked: [], missing: [], failed: ["anillo-plata"] });

    const response = await deliver();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "pieces not marked sold" });
    // The money has arrived: the ledger does not wait for Sanity's write path.
    expect(recordStripeSaleMock).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(
      "[stripe] Pieces could not be marked sold; answering 500 so Stripe retries.",
    );
  });

  it("answers 500 when ANY of several pieces failed, even if the others were marked", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    eventOf("checkout.session.completed", session({ metadata: { handles: "a,b,c" } }));
    markProductsSoldMock.mockResolvedValue({ marked: ["a", "c"], missing: [], failed: ["b"] });

    const response = await deliver();

    expect(response.status).toBe(500);
  });

  it("does NOT treat a product that no longer exists as a failure: a retry could not change it", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    markProductsSoldMock.mockResolvedValue({ marked: [], missing: ["anillo-plata"], failed: [] });

    const response = await deliver();

    expect(response.status).toBe(200);
    expect(recordStripeSaleMock).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
  });

  it("answers 500 when the sale cannot be recorded, so Stripe retries — after the piece was marked sold", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    recordStripeSaleMock.mockRejectedValueOnce(new Error("4 DEADLINE_EXCEEDED"));

    const response = await deliver();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "sale not recorded" });
    expect(markProductsSoldMock).toHaveBeenCalledWith(["anillo-plata"]);
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
    // The piece was still taken off the shelf.
    expect(markProductsSoldMock).toHaveBeenCalledWith(["anillo-plata"]);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(
      "[stripe] Sale not recorded: Firestore is not configured; answering 500 so Stripe retries.",
    );
  });

  it("answers ONE 500 naming every reason when both steps fail", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    markProductsSoldMock.mockResolvedValue({ marked: [], missing: [], failed: ["anillo-plata"] });
    recordStripeSaleMock.mockRejectedValueOnce(new Error("down"));

    const response = await deliver();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "pieces not marked sold; sale not recorded",
    });
    expect(error).toHaveBeenCalledTimes(2);
  });

  it.each(["duplicate", "skipped"])(
    "answers 200 quietly when the recorder reports %s",
    async (outcome) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
      recordStripeSaleMock.mockResolvedValueOnce(outcome);

      const response = await deliver();

      expect(response.status).toBe(200);
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    },
  );

  it("logs only fixed lines, never the session, a handle or the error", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    markProductsSoldMock.mockResolvedValue({ marked: [], missing: [], failed: ["anillo-plata"] });
    recordStripeSaleMock.mockRejectedValueOnce(new Error("detail buyer@example.com"));

    await deliver();

    const logged = JSON.stringify(error.mock.calls);
    expect(logged).not.toContain("buyer@example.com");
    expect(logged).not.toContain("anillo-plata");
    expect(logged).not.toContain("cs_test_1");
  });
});

describe("POST /api/stripe/webhook — unrelated event types", () => {
  it("returns 200 and never writes for an event type this endpoint doesn't handle", async () => {
    eventOf("payment_intent.succeeded", {});

    const response = await deliver();

    expect(response.status).toBe(200);
    expect(markProductsSoldMock).not.toHaveBeenCalled();
    expect(recordStripeSaleMock).not.toHaveBeenCalled();
  });
});
