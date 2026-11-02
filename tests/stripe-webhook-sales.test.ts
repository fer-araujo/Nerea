import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeFirestore, type FakeTransaction } from "@/tests/helpers/fake-firestore";

type TransactionBody = (tx: FakeTransaction) => Promise<unknown>;

// The route, the sale recorder, the stock-progress helpers and the sales
// document builder all run for real here; only the edges are faked (Firestore,
// Sanity's catalog and write path, Stripe's signature check). That is what lets
// "a duplicate delivery does not double", "a failed write is a 500 and the
// retry lands once", "a redelivery never takes the units off twice" and
// "nothing personal is stored" be asserted on what ends up in the database.
// The route's own branching is covered with a mocked recorder in
// tests/stripe-webhook.test.ts.
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

const getStripeClientMock = vi.fn();
const constructEventMock = vi.fn();
// The same client verifies the signature and, when a sale is recorded, reads
// the payment's balance transaction (the fee and the net).
const retrieveMock = vi.fn();
vi.mock("@/lib/commerce/stripe/client", () => ({
  getStripeClient: () => getStripeClientMock(),
}));

const decrementStockMock = vi.fn();
vi.mock("@/lib/commerce/sanity/stock", () => ({
  decrementStock: (...args: unknown[]) => decrementStockMock(...args),
}));

// The route expires the cached catalog once units are taken off; the real
// revalidateTag needs a live Next request context.
const revalidateTagMock = vi.fn();
vi.mock("next/cache", () => ({
  revalidateTag: (...args: unknown[]) => revalidateTagMock(...args),
}));

const getProductByHandleMock = vi.fn();
vi.mock("@/lib/commerce", () => ({
  commerce: {
    getProductByHandle: (...args: unknown[]) => getProductByHandleMock(...args),
  },
}));

import { POST } from "@/app/api/stripe/webhook/route";

const ORIGINAL_ENV = { ...process.env };
const SESSION_ID = "cs_test_a1B2c3D4";
const SALE_PATH = `sales/stripe_${SESSION_ID}`;

// What Stripe really puts in a completed session, buyer's details included.
const PII_FRAGMENTS = [
  "ana.perez@example.com",
  "Ana Pérez",
  "+525512345678",
  "Calle Falsa 123",
  "Guadalajara",
  "44100",
  "cus_PII123",
];

// What decrementStock answers when it did its job.
const DONE = {
  decremented: ["anillo-luna"],
  missing: [],
  failed: [],
  oversold: [],
  alreadyApplied: [],
};

function completedSession(overrides: Record<string, unknown> = {}) {
  return {
    id: SESSION_ID,
    // Paid: the one state in which anything is sold or recorded.
    payment_status: "paid",
    created: 1_790_000_000,
    amount_subtotal: 185_000,
    amount_total: 200_000,
    currency: "mxn",
    shipping_cost: { amount_subtotal: 15_000, amount_tax: 0, amount_total: 15_000 },
    metadata: { handles: "anillo-luna", options: "anillo-luna:size=7" },
    customer: "cus_PII123",
    customer_email: "ana.perez@example.com",
    customer_details: {
      email: "ana.perez@example.com",
      name: "Ana Pérez",
      phone: "+525512345678",
      address: { line1: "Calle Falsa 123", city: "Guadalajara", postal_code: "44100" },
    },
    shipping_details: {
      name: "Ana Pérez",
      address: { line1: "Calle Falsa 123", city: "Guadalajara", postal_code: "44100" },
    },
    ...overrides,
  };
}

function deliver(
  session: Record<string, unknown> = completedSession(),
  type = "checkout.session.completed",
) {
  constructEventMock.mockReturnValue({ type, data: { object: session } });
  return POST(
    new Request("https://nerea.example/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": "sig_test" },
      body: "{}",
    }),
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  fake = new FakeFirestore();
  configured = true;
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_secret";
  getStripeClientMock.mockReturnValue({
    webhooks: { constructEvent: constructEventMock },
    checkout: { sessions: { retrieve: retrieveMock } },
  });
  retrieveMock.mockResolvedValue({
    id: SESSION_ID,
    payment_intent: {
      latest_charge: {
        balance_transaction: { fee: 7_540, net: 192_460, currency: "mxn" },
      },
    },
  });
  decrementStockMock.mockResolvedValue(DONE);
  getProductByHandleMock.mockResolvedValue({
    handle: "anillo-luna",
    title: "Anillo Luna",
    description: "",
    price: { amount: 185_000, currency: "MXN" },
    availability: "sold",
    cover: null,
    media: [],
    options: { kind: "ringSize", values: ["6", "7", "8"] },
  });
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe("webhook -> sales ledger: recording", () => {
  it("records a completed checkout once, as stripe_<session id>, then takes its unit off the stock", async () => {
    fake.seed("pieces/anillo-luna", { costs: { metal: 40_000, stones: 15_000, other: 5_000 } });

    const response = await deliver();

    expect(response.status).toBe(200);
    expect(decrementStockMock).toHaveBeenCalledWith([{ handle: "anillo-luna", qty: 1 }], SESSION_ID);
    expect(fake.directChildren("sales").map((entry) => entry.path)).toEqual([SALE_PATH]);
    expect(fake.get(SALE_PATH)).toMatchObject({
      source: "stripe",
      status: "active",
      items: [
        {
          handle: "anillo-luna",
          title: "Anillo Luna",
          price: 185_000,
          quantity: 1,
          option: "Talla 7",
        },
      ],
      subtotal: 185_000,
      shipping: 15_000,
      total: 200_000,
      currency: "MXN",
      costOfGoods: 60_000,
      costPending: false,
      stripeSessionId: SESSION_ID,
      // Every unit is off the stock: a redelivery has nothing left to do.
      stockApplied: true,
    });
  });

  it("expires the cached catalog right after the units are taken off, so the shop stops offering them", async () => {
    await deliver();

    expect(revalidateTagMock).toHaveBeenCalledTimes(1);
    expect(revalidateTagMock).toHaveBeenCalledWith("products", { expire: 0 });
  });

  it("stores the mode of the verified session and what Stripe charged for the payment", async () => {
    await deliver(completedSession({ livemode: true, id: "cs_live_a1B2c3D4" }));

    expect(fake.get("sales/stripe_cs_live_a1B2c3D4")).toMatchObject({
      livemode: true,
      stripeFee: 7_540,
      stripeNet: 192_460,
      feePending: false,
    });

    await deliver(completedSession({ livemode: false }));

    expect(fake.get(SALE_PATH)).toMatchObject({ livemode: false, stripeFee: 7_540 });
  });

  it("still answers 200 and records the sale, as feePending, when Stripe cannot give the fee", async () => {
    retrieveMock.mockRejectedValue(new Error("network down"));

    const response = await deliver();

    expect(response.status).toBe(200);
    expect(decrementStockMock).toHaveBeenCalledWith([{ handle: "anillo-luna", qty: 1 }], SESSION_ID);
    const stored = fake.get(SALE_PATH);
    expect(stored).toMatchObject({ source: "stripe", total: 200_000, feePending: true });
    expect(stored).not.toHaveProperty("stripeFee");
    expect(stored).not.toHaveProperty("stripeNet");
  });

  it("does not answer 500 for a missing fee, so Stripe never redelivers an event for that", async () => {
    retrieveMock.mockResolvedValue({ id: SESSION_ID, payment_intent: { latest_charge: null } });

    const response = await deliver();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
  });

  it("records the sale BEFORE it takes the units off: the sale document is what keeps a redelivery from doing it twice", async () => {
    const order: string[] = [];
    decrementStockMock.mockImplementation(async () => {
      order.push("decrement-stock");
      return DONE;
    });
    const run = fake.runTransaction.bind(fake);
    vi.spyOn(fake, "runTransaction").mockImplementation((async (update: TransactionBody) => {
      // Only the sale's creation (not the progress update after the stock).
      if (order.length === 0) order.push("record-sale");
      return run(update);
    }) as FakeFirestore["runTransaction"]);

    await deliver();

    expect(order).toEqual(["record-sale", "decrement-stock"]);
  });

  it("does NOT double the sale, or the stock, when Stripe delivers the same event twice", async () => {
    const first = await deliver();
    const afterFirst = fake.get(SALE_PATH);
    const second = await deliver();

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(fake.directChildren("sales")).toHaveLength(1);
    // The sale is created once and updated once (the stock marker): the second
    // delivery writes nothing at all.
    expect(fake.opsMatching(/^sales\//)).toHaveLength(2);
    expect(fake.get(SALE_PATH)).toEqual(afterFirst);
    // Taking units off is NOT idempotent, so the marker keeps it from running again.
    expect(decrementStockMock).toHaveBeenCalledTimes(1);
    expect(revalidateTagMock).toHaveBeenCalledTimes(1);
  });

  it("records a multi-quantity checkout: per-line quantity, cost times quantity, the units off the stock", async () => {
    fake.seed("pieces/anillo-luna", { costs: { metal: 40_000, stones: 15_000, other: 5_000 } });
    decrementStockMock.mockResolvedValue({ ...DONE, decremented: ["anillo-luna"] });

    const response = await deliver(
      completedSession({
        amount_subtotal: 555_000,
        amount_total: 570_000,
        metadata: {
          handles: "anillo-luna",
          items: "anillo-luna*2|size=7;anillo-luna*1|size=6",
          options: "anillo-luna:size=7,anillo-luna:size=6",
        },
      }),
    );

    expect(response.status).toBe(200);
    // ONE decrement for the design, its two sizes added up.
    expect(decrementStockMock).toHaveBeenCalledWith([{ handle: "anillo-luna", qty: 3 }], SESSION_ID);
    expect(fake.get(SALE_PATH)).toMatchObject({
      items: [
        { handle: "anillo-luna", price: 185_000, quantity: 2, option: "Talla 7" },
        { handle: "anillo-luna", price: 185_000, quantity: 1, option: "Talla 6" },
      ],
      subtotal: 555_000,
      // 3 units x 60_000 of cost each.
      costOfGoods: 180_000,
      costPending: false,
    });
    // One catalog read for the design, however many sizes.
    expect(getProductByHandleMock).toHaveBeenCalledTimes(1);
  });

  it("still reads a legacy session (handles and options only) as one unit per piece", async () => {
    const response = await deliver(completedSession());

    expect(response.status).toBe(200);
    expect(fake.get(SALE_PATH)).toMatchObject({
      items: [{ handle: "anillo-luna", quantity: 1, option: "Talla 7" }],
    });
  });

  it("flags the sale 'oversold', and still answers 200, when more units were sold than the shop had", async () => {
    decrementStockMock.mockResolvedValue({ ...DONE, oversold: ["anillo-luna"] });

    const response = await deliver();

    expect(response.status).toBe(200);
    expect(fake.get(SALE_PATH)).toMatchObject({ stockApplied: true, oversold: true });
  });

  it("does not flag a sale oversold when nothing went below zero", async () => {
    await deliver();

    expect(fake.get(SALE_PATH)).not.toHaveProperty("oversold");
  });

  it("records nothing for a session this storefront did not create (no pieces in its metadata)", async () => {
    const response = await deliver(completedSession({ metadata: {} }));

    expect(response.status).toBe(200);
    expect(fake.committed).toHaveLength(0);
    expect(getProductByHandleMock).not.toHaveBeenCalled();
  });
});

describe("webhook -> sales ledger: failures", () => {
  it("answers 500 when the sale cannot be written, so Stripe retries, and the retry lands exactly once", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const spy = vi
      .spyOn(fake, "runTransaction")
      .mockRejectedValueOnce(new Error("4 DEADLINE_EXCEEDED"));

    const failed = await deliver();

    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: "sale not recorded" });
    // The sale document is the idempotency token: no sale, no decrement yet.
    expect(decrementStockMock).not.toHaveBeenCalled();
    expect(fake.directChildren("sales")).toHaveLength(0);

    spy.mockRestore();
    const retried = await deliver();

    expect(retried.status).toBe(200);
    expect(fake.directChildren("sales")).toHaveLength(1);
    expect(decrementStockMock).toHaveBeenCalledTimes(1);
  });

  it("survives a write that LANDED but reported an error: the retry is a harmless duplicate", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const run = fake.runTransaction.bind(fake);
    vi.spyOn(fake, "runTransaction").mockImplementationOnce((async (update: TransactionBody) => {
      await run(update);
      throw new Error("13 INTERNAL: connection reset after commit");
    }) as FakeFirestore["runTransaction"]);

    const failed = await deliver();
    const retried = await deliver();

    expect(failed.status).toBe(500);
    expect(retried.status).toBe(200);
    expect(fake.directChildren("sales")).toHaveLength(1);
    // The sale (created once, by the first attempt) and the stock marker.
    expect(fake.opsMatching(/^sales\//)).toHaveLength(2);
    // The first attempt failed before the stock; the retry found the sale
    // without a marker and took the unit off, once.
    expect(decrementStockMock).toHaveBeenCalledTimes(1);
    expect(fake.get(SALE_PATH)).toMatchObject({ stockApplied: true });
  });

  it("answers 500 when the catalog cannot be read, rather than record a sale with guessed titles", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    getProductByHandleMock.mockRejectedValue(new Error("network down"));

    const response = await deliver();

    expect(response.status).toBe(500);
    expect(fake.committed).toHaveLength(0);
  });

  it("logs one FIXED line on failure: nothing from the session or the error", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(fake, "runTransaction").mockRejectedValue(
      new Error("secret detail ana.perez@example.com"),
    );

    await deliver();

    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(
      "[stripe] Sale could not be recorded; answering 500 so Stripe retries.",
    );
  });

  it("answers 500, with ONE fixed log line, when Firebase is not configured: a paid sale is not silently lost", async () => {
    configured = false;
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await deliver();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "sale ledger not configured" });
    // Nothing was written, and the stock waits for the sale to exist.
    expect(decrementStockMock).not.toHaveBeenCalled();
    expect(fake.committed).toHaveLength(0);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(
      "[stripe] Sale not recorded: Firestore is not configured; answering 500 so Stripe retries.",
    );
  });

  it("records the sale on the retry once the misconfiguration is fixed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    configured = false;
    const failed = await deliver();

    configured = true;
    const retried = await deliver();

    expect(failed.status).toBe(500);
    expect(retried.status).toBe(200);
    expect(fake.directChildren("sales")).toHaveLength(1);
  });

  it("answers 500 when a piece's stock could not be updated, yet keeps the sale; the retry then lands once", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    decrementStockMock.mockResolvedValueOnce({
      decremented: [],
      missing: [],
      failed: ["anillo-luna"],
      oversold: [],
    });

    const failed = await deliver();

    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: "stock not updated" });
    // The money arrived: the sale is on record, and says the stock is NOT done.
    expect(fake.directChildren("sales")).toHaveLength(1);
    expect(fake.get(SALE_PATH)).toMatchObject({ stockApplied: false });
    expect(error).toHaveBeenCalledWith(
      "[stripe] Stock could not be updated; answering 500 so Stripe retries.",
    );

    // Sanity is back: the redelivered event takes the unit off, and the sale is
    // a harmless duplicate.
    const retried = await deliver();

    expect(retried.status).toBe(200);
    expect(decrementStockMock).toHaveBeenCalledTimes(2);
    expect(fake.directChildren("sales")).toHaveLength(1);
    expect(fake.get(SALE_PATH)).toMatchObject({ stockApplied: true });

    // And from here on a further redelivery does nothing.
    const again = await deliver();
    expect(again.status).toBe(200);
    expect(decrementStockMock).toHaveBeenCalledTimes(2);
  });

  it("after a PARTIAL failure, asks for every piece again: Sanity's markers skip the one that landed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    getProductByHandleMock.mockImplementation(async (handle: string) => ({
      handle,
      title: handle,
      description: "",
      price: { amount: 100_000, currency: "MXN" },
      availability: "sold",
      stock: 0,
      cover: null,
      media: [],
      options: { kind: "none" },
    }));
    const session = completedSession({
      amount_subtotal: 300_000,
      amount_total: 300_000,
      shipping_cost: { amount_total: 0 },
      metadata: { handles: "uno,dos", items: "uno*2;dos*1" },
    });
    const ASKED = [
      { handle: "uno", qty: 2 },
      { handle: "dos", qty: 1 },
    ];
    decrementStockMock.mockResolvedValueOnce({
      decremented: ["uno"],
      missing: [],
      failed: ["dos"],
      oversold: [],
      alreadyApplied: [],
    });

    const failed = await deliver(session);

    expect(failed.status).toBe(500);
    expect(decrementStockMock).toHaveBeenLastCalledWith(ASKED, SESSION_ID);
    expect(fake.get(SALE_PATH)).toMatchObject({ stockApplied: false });

    decrementStockMock.mockResolvedValueOnce({
      decremented: ["uno", "dos"],
      missing: [],
      failed: [],
      oversold: [],
      alreadyApplied: ["uno"],
    });
    const retried = await deliver(session);

    expect(retried.status).toBe(200);
    // The same request: it is decrementStock's markers that skip "uno", so the
    // webhook needs no bookkeeping of its own about which piece landed.
    expect(decrementStockMock).toHaveBeenLastCalledWith(ASKED, SESSION_ID);
    expect(fake.get(SALE_PATH)).toMatchObject({ stockApplied: true });
    expect(fake.get(SALE_PATH)).not.toHaveProperty("stockDone");
  });

  it("answers 500 for every paid delivery while the Sanity write token is missing, so it is seen in Stripe", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    // decrementStock reports a missing token as every piece failed.
    decrementStockMock.mockResolvedValue({
      decremented: [],
      missing: [],
      failed: ["anillo-luna"],
      oversold: [],
    });

    const first = await deliver();
    const second = await deliver();

    expect(first.status).toBe(500);
    expect(second.status).toBe(500);
    expect(fake.directChildren("sales")).toHaveLength(1);
  });

  it("does not treat a product deleted from Sanity as a failure", async () => {
    decrementStockMock.mockResolvedValue({
      decremented: [],
      missing: ["anillo-luna"],
      failed: [],
      oversold: [],
    });

    const response = await deliver();

    expect(response.status).toBe(200);
    expect(fake.directChildren("sales")).toHaveLength(1);
  });
});

describe("webhook -> sales ledger: pay before sell", () => {
  it("sells and records NOTHING for a completed checkout that is not paid yet", async () => {
    const response = await deliver(completedSession({ payment_status: "unpaid" }));

    expect(response.status).toBe(200);
    expect(decrementStockMock).not.toHaveBeenCalled();
    expect(getProductByHandleMock).not.toHaveBeenCalled();
    expect(fake.committed).toHaveLength(0);
  });

  it("sells and records when the delayed payment finally succeeds, exactly once", async () => {
    const unpaid = await deliver(completedSession({ payment_status: "unpaid" }));
    expect(fake.committed).toHaveLength(0);

    const paid = await deliver(
      completedSession({ payment_status: "paid" }),
      "checkout.session.async_payment_succeeded",
    );
    const redelivered = await deliver(
      completedSession({ payment_status: "paid" }),
      "checkout.session.async_payment_succeeded",
    );

    expect(unpaid.status).toBe(200);
    expect(paid.status).toBe(200);
    expect(redelivered.status).toBe(200);
    expect(decrementStockMock).toHaveBeenCalledTimes(1);
    expect(decrementStockMock).toHaveBeenCalledWith([{ handle: "anillo-luna", qty: 1 }], SESSION_ID);
    expect(fake.directChildren("sales").map((entry) => entry.path)).toEqual([SALE_PATH]);
  });

  it("sells and records nothing when a delayed payment fails", async () => {
    const response = await deliver(
      completedSession({ payment_status: "unpaid" }),
      "checkout.session.async_payment_failed",
    );

    expect(response.status).toBe(200);
    expect(decrementStockMock).not.toHaveBeenCalled();
    expect(fake.committed).toHaveLength(0);
  });

  it("does not let a failed delayed payment undo a sale that was already paid and recorded", async () => {
    await deliver();
    const before = fake.get(SALE_PATH);

    const response = await deliver(
      completedSession({ payment_status: "unpaid" }),
      "checkout.session.async_payment_failed",
    );

    expect(response.status).toBe(200);
    expect(fake.get(SALE_PATH)).toEqual(before);
  });
});

describe("webhook -> sales ledger: the signature gate still comes first", () => {
  it("records nothing and marks nothing for a bad signature", async () => {
    constructEventMock.mockImplementation(() => {
      throw new Error("No signatures found matching the expected signature");
    });

    const response = await POST(
      new Request("https://nerea.example/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "forged" },
        body: "{}",
      }),
    );

    expect(response.status).toBe(400);
    expect(decrementStockMock).not.toHaveBeenCalled();
    expect(getProductByHandleMock).not.toHaveBeenCalled();
    expect(fake.committed).toHaveLength(0);
  });

  it("records nothing for a request with no signature header or no secret", async () => {
    const noHeader = await POST(
      new Request("https://nerea.example/api/stripe/webhook", { method: "POST", body: "{}" }),
    );
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const noSecret = await deliver();

    expect(noHeader.status).toBe(400);
    expect(noSecret.status).toBe(400);
    expect(fake.committed).toHaveLength(0);
  });

  it("records nothing for an event type it does not handle", async () => {
    constructEventMock.mockReturnValue({
      type: "payment_intent.succeeded",
      data: { object: completedSession() },
    });

    const response = await POST(
      new Request("https://nerea.example/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig_test" },
        body: "{}",
      }),
    );

    expect(response.status).toBe(200);
    expect(fake.committed).toHaveLength(0);
  });
});

describe("webhook -> sales ledger: no customer data is ever stored", () => {
  it("keeps the buyer's email, name, address, phone and customer id out of the stored sale", async () => {
    // The session expanded for the fee carries the buyer's details too: the
    // charge's billing details, the customer.
    retrieveMock.mockResolvedValue({
      id: SESSION_ID,
      customer: "cus_PII123",
      customer_details: { email: "ana.perez@example.com", name: "Ana Pérez" },
      payment_intent: {
        receipt_email: "ana.perez@example.com",
        latest_charge: {
          billing_details: {
            name: "Ana Pérez",
            phone: "+525512345678",
            address: { line1: "Calle Falsa 123", city: "Guadalajara", postal_code: "44100" },
          },
          balance_transaction: { fee: 7_540, net: 192_460, currency: "mxn" },
        },
      },
    });

    await deliver();

    const stored = fake.get(SALE_PATH);
    expect(stored).toBeDefined();

    // Not in the document, not in anything that was written.
    const everything = JSON.stringify([stored, fake.committed]);
    for (const fragment of PII_FRAGMENTS) {
      expect(everything).not.toContain(fragment);
    }

    // And the document can only hold the documented fields.
    expect(Object.keys(stored ?? {}).sort()).toEqual(
      [
        "costOfGoods",
        "costPending",
        "createdAt",
        "currency",
        "date",
        "feePending",
        "items",
        "livemode",
        "shipping",
        "source",
        "status",
        "stripeFee",
        "stripeNet",
        "stockApplied",
        "stripeSessionId",
        "subtotal",
        "total",
      ].sort(),
    );
  });

  it("writes no audit entry carrying anything either (a webhook has no admin to audit)", async () => {
    await deliver();

    expect(fake.directChildren("auditLog")).toHaveLength(0);
  });
});
