import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeFirestore, type FakeTransaction } from "@/tests/helpers/fake-firestore";
import { FakeSanity, type StoredDoc } from "@/tests/helpers/fake-sanity";

type TransactionBody = (tx: FakeTransaction) => Promise<unknown>;

// The whole chain runs for real: the route, the sale recorder, the stock
// progress helpers AND decrementStock with its marker documents. Only the edges
// are faked (Firestore, Sanity's write client, Stripe's signature check, the
// catalog read). That is what lets "a delivery, however it is repeated, takes a
// unit off the stock ONCE" be asserted on the numbers that end up in Sanity.
// The route's own branching is in tests/stripe-webhook.test.ts; decrementStock's
// in tests/decrement-stock.test.ts.
vi.mock("server-only", () => ({}));

vi.mock("firebase-admin/firestore", async () => {
  const fake = await import("@/tests/helpers/fake-firestore");
  return {
    FieldValue: { serverTimestamp: () => fake.SERVER_TIMESTAMP },
    Timestamp: { fromDate: (date: Date) => new fake.FakeTimestamp(date) },
  };
});

let fake: FakeFirestore;
vi.mock("@/lib/admin/firebase/admin", () => ({
  getAdminDb: () => fake,
}));

let sanity: FakeSanity;
vi.mock("@/lib/sanity/write-client", () => ({
  getSanityWriteClient: () => sanity,
}));

const getStripeClientMock = vi.fn();
const constructEventMock = vi.fn();
const retrieveMock = vi.fn();
vi.mock("@/lib/commerce/stripe/client", () => ({
  getStripeClient: () => getStripeClientMock(),
}));

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

function doc(slug: string, fields: Partial<StoredDoc> = {}): StoredDoc {
  return { _id: `id-${slug}`, slug, status: "available", ...fields };
}

function completedSession(overrides: Record<string, unknown> = {}) {
  return {
    id: SESSION_ID,
    payment_status: "paid",
    created: 1_790_000_000,
    amount_subtotal: 370_000,
    amount_total: 370_000,
    shipping_cost: { amount_total: 0 },
    metadata: { handles: "anillo-luna", items: "anillo-luna*2" },
    ...overrides,
  };
}

function deliver(session: Record<string, unknown> = completedSession()) {
  constructEventMock.mockReturnValue({
    type: "checkout.session.completed",
    data: { object: session },
  });
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
  sanity = new FakeSanity(doc("anillo-luna", { stock: 5 }), doc("aretes-sol", { stock: 3 }));
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_secret";
  getStripeClientMock.mockReturnValue({
    webhooks: { constructEvent: constructEventMock },
    checkout: { sessions: { retrieve: retrieveMock } },
  });
  retrieveMock.mockResolvedValue({
    id: SESSION_ID,
    payment_intent: {
      latest_charge: {
        balance_transaction: { fee: 7_540, net: 362_460, currency: "mxn" },
      },
    },
  });
  getProductByHandleMock.mockImplementation(async (handle: string) => ({
    handle,
    title: handle,
    description: "",
    price: { amount: 185_000, currency: "MXN" },
    availability: "available",
    stock: 5,
    cover: null,
    media: [],
    options: { kind: "none" },
  }));
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe("the stock is taken off ONCE per sale, however the delivery is repeated", () => {
  it("takes the units off on the first delivery and leaves them alone on a redelivery", async () => {
    const first = await deliver();
    const second = await deliver();

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(sanity.stockOf("anillo-luna")).toBe(3);
    expect(sanity.markers.size).toBe(1);
    expect(fake.get(SALE_PATH)).toMatchObject({ stockApplied: true });
  });

  it("a failure BETWEEN the decrement and saving its progress: the retry does not decrement again", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const run = fake.runTransaction.bind(fake);
    let transactions = 0;
    // 1st: the sale's creation. 2nd: the progress save, which fails.
    const spy = vi.spyOn(fake, "runTransaction").mockImplementation((async (
      update: TransactionBody,
    ) => {
      transactions += 1;
      if (transactions === 2) throw new Error("14 UNAVAILABLE");
      return run(update);
    }) as FakeFirestore["runTransaction"]);

    const failed = await deliver();

    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: "stock progress not saved" });
    // The units ARE off, though the sale does not say so yet.
    expect(sanity.stockOf("anillo-luna")).toBe(3);
    expect(fake.get(SALE_PATH)).not.toHaveProperty("stockApplied");

    spy.mockRestore();
    const retried = await deliver();

    expect(retried.status).toBe(200);
    expect(sanity.stockOf("anillo-luna")).toBe(3);
    expect(fake.get(SALE_PATH)).toMatchObject({ stockApplied: true });
  });

  it("a transaction that LANDED in Sanity but reported an error: the retry does not decrement again", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    sanity.failAfterCommitFor.add("anillo-luna");

    const failed = await deliver();

    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: "stock not updated" });
    expect(sanity.stockOf("anillo-luna")).toBe(3);

    const retried = await deliver();

    expect(retried.status).toBe(200);
    expect(sanity.stockOf("anillo-luna")).toBe(3);
    expect(fake.get(SALE_PATH)).toMatchObject({ stockApplied: true });
  });

  it("two near-simultaneous deliveries of the same event decrement ONCE", async () => {
    const [a, b] = await Promise.all([deliver(), deliver()]);

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(sanity.stockOf("anillo-luna")).toBe(3);
    expect(sanity.markers.size).toBe(1);
    expect(fake.directChildren("sales")).toHaveLength(1);
  });

  it("a sale recorded BEFORE markers existed, re-sent from the Dashboard, is decremented once", async () => {
    // The sale is on record (from the earlier deploy) with no stock marker, and
    // no Sanity marker exists either.
    fake.seed(SALE_PATH, {
      source: "stripe",
      status: "active",
      items: [{ handle: "anillo-luna", title: "anillo-luna", price: 185_000, quantity: 2 }],
      subtotal: 370_000,
      shipping: 0,
      total: 370_000,
      currency: "MXN",
      costOfGoods: 0,
      costPending: true,
      stripeSessionId: SESSION_ID,
      livemode: false,
    });
    expect(sanity.markers.size).toBe(0);

    const resent = await deliver();
    const again = await deliver();

    expect(resent.status).toBe(200);
    expect(again.status).toBe(200);
    expect(sanity.stockOf("anillo-luna")).toBe(3);
    expect(sanity.markers.size).toBe(1);
  });

  it("a sale whose progress flag was never saved is not decremented a second time by a Dashboard resend", async () => {
    await deliver();
    // Simulate the flag being lost: the sale exists, the markers exist.
    fake.seed(SALE_PATH, { ...(fake.get(SALE_PATH) ?? {}), stockApplied: false });

    const resent = await deliver();

    expect(resent.status).toBe(200);
    expect(sanity.stockOf("anillo-luna")).toBe(3);
  });

  it("after a PARTIAL failure, the retry lands only the piece that did not land", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const session = completedSession({
      amount_subtotal: 740_000,
      amount_total: 740_000,
      metadata: { handles: "anillo-luna,aretes-sol", items: "anillo-luna*2;aretes-sol*1" },
    });
    sanity.failTransactionFor.add("aretes-sol");

    const failed = await deliver(session);

    expect(failed.status).toBe(500);
    expect(sanity.stockOf("anillo-luna")).toBe(3);
    expect(sanity.stockOf("aretes-sol")).toBe(3);
    expect(fake.get(SALE_PATH)).toMatchObject({ stockApplied: false });

    sanity.failTransactionFor.clear();
    const retried = await deliver(session);

    expect(retried.status).toBe(200);
    // "anillo-luna" was NOT taken off a second time; "aretes-sol" now is.
    expect(sanity.stockOf("anillo-luna")).toBe(3);
    expect(sanity.stockOf("aretes-sol")).toBe(2);
    expect(fake.get(SALE_PATH)).toMatchObject({ stockApplied: true });
  });

  it("still takes the units off for a DIFFERENT sale of the same piece", async () => {
    await deliver();
    await deliver(
      completedSession({ id: "cs_test_other", metadata: { items: "anillo-luna*1" } }),
    );

    expect(sanity.stockOf("anillo-luna")).toBe(2);
    expect(sanity.markers.size).toBe(2);
  });

  it("flags an oversell on the sale, and a redelivery neither repeats nor loses it", async () => {
    sanity = new FakeSanity(doc("anillo-luna", { stock: 1 }));

    const first = await deliver();
    const second = await deliver();

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(sanity.stockOf("anillo-luna")).toBe(0);
    expect(fake.get(SALE_PATH)).toMatchObject({ stockApplied: true, oversold: true });
  });

  it("takes the unit off the PUBLISHED document when a draft of the piece exists", async () => {
    sanity = new FakeSanity(
      { _id: "drafts.id-anillo-luna", slug: "anillo-luna", status: "available", stock: 9 },
      doc("anillo-luna", { stock: 5 }),
    );

    await deliver();

    expect(sanity.docs.get("id-anillo-luna")?.stock).toBe(3);
    expect(sanity.docs.get("drafts.id-anillo-luna")?.stock).toBe(9);
  });

  it("answers 500 for every paid delivery while the Sanity write token is missing, creating no marker", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const noToken = sanity;
    sanity = undefined as unknown as FakeSanity;

    const first = await deliver();

    expect(first.status).toBe(500);
    expect(noToken.markers.size).toBe(0);
    expect(fake.get(SALE_PATH)).toMatchObject({ stockApplied: false });
  });
});
