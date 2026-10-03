import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FakeFirestore,
  FakeTimestamp,
  SERVER_TIMESTAMP,
} from "@/tests/helpers/fake-firestore";
import type { Product } from "@/lib/commerce/types";

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

// The catalog is the one the storefront reads (`commerce`), mocked at that seam.
const getProductByHandleMock = vi.fn();
vi.mock("@/lib/commerce", () => ({
  commerce: {
    getProductByHandle: (...args: unknown[]) => getProductByHandleMock(...args),
  },
}));

import { isAlreadyExistsError } from "@/lib/admin/data/shared";
import {
  recordStripeSale,
  type StripeSaleSession,
} from "@/lib/admin/data/stripe-sales";

const SESSION_ID = "cs_test_a1B2c3D4";
const SALE_PATH = `sales/stripe_${SESSION_ID}`;
const CREATED = 1_790_000_000; // unix seconds

function product(overrides: Partial<Product> = {}): Product {
  return {
    handle: "anillo-luna",
    title: "Anillo Luna",
    description: "",
    price: { amount: 185_000, currency: "MXN" },
    availability: "sold",
    cover: null,
    media: [],
    options: { kind: "none" },
    ...overrides,
  };
}

function stockCatalog(...products: Product[]) {
  getProductByHandleMock.mockImplementation(async (handle: string) => {
    return products.find((candidate) => candidate.handle === handle) ?? null;
  });
}

function session(overrides: Partial<StripeSaleSession> = {}): StripeSaleSession {
  return {
    id: SESSION_ID,
    created: CREATED,
    amount_subtotal: 185_000,
    amount_total: 200_000,
    shipping_cost: { amount_total: 15_000 },
    metadata: { handles: "anillo-luna" },
    ...overrides,
  };
}

function seedCost(
  handle: string,
  costs: Record<string, number> = { metal: 40_000, stones: 15_000, other: 5_000 },
) {
  fake.seed(`pieces/${handle}`, { handle, costs });
}

beforeEach(() => {
  vi.resetAllMocks();
  fake = new FakeFirestore();
  configured = true;
  stockCatalog(product());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("recordStripeSale", () => {
  it("records the sale as stripe_<session id> with the session's own totals", async () => {
    seedCost("anillo-luna"); // 60_000

    await expect(recordStripeSale(session())).resolves.toBe("recorded");

    expect(fake.transactionsRun).toBe(1);
    expect(getProductByHandleMock).toHaveBeenCalledWith("anillo-luna", "es");
    const stored = fake.get(SALE_PATH);
    expect(stored).toEqual({
      source: "stripe",
      status: "active",
      date: expect.any(FakeTimestamp),
      items: [{ handle: "anillo-luna", title: "Anillo Luna", price: 185_000 }],
      subtotal: 185_000,
      shipping: 15_000,
      total: 200_000,
      currency: "MXN",
      costOfGoods: 60_000,
      costPending: false,
      stripeSessionId: SESSION_ID,
      createdAt: expect.any(FakeTimestamp),
    });
    // The payment's own instant, not the moment the webhook happened to run.
    expect((stored?.date as FakeTimestamp).toDate()).toEqual(new Date(CREATED * 1000));
  });

  it("has no actor (no admin did this) and stamps createdAt on the server", async () => {
    await recordStripeSale(session());

    expect(fake.get(SALE_PATH)).not.toHaveProperty("actor");
    expect(fake.opsMatching(/^sales\//, "create")[0]).toMatchObject({
      data: { createdAt: SERVER_TIMESTAMP },
    });
  });

  it("writes the sale with create, so a second delivery cannot overwrite or double it", async () => {
    await recordStripeSale(session());

    const ops = fake.opsMatching(/^sales\//);
    expect(ops).toHaveLength(1);
    expect(ops[0].kind).toBe("create");
  });
});

describe("recordStripeSale: idempotency", () => {
  it("answers 'duplicate' for a session that is already recorded, and leaves the sale untouched", async () => {
    seedCost("anillo-luna");
    await recordStripeSale(session());
    const first = fake.get(SALE_PATH);
    // The cost changes between the two deliveries.
    seedCost("anillo-luna", { metal: 1, stones: 0, other: 0 });

    await expect(recordStripeSale(session())).resolves.toBe("duplicate");

    expect(fake.directChildren("sales")).toHaveLength(1);
    expect(fake.get(SALE_PATH)).toEqual(first);
    expect(fake.opsMatching(/^sales\//)).toHaveLength(1);
  });

  it("keeps different sessions as different sales", async () => {
    await recordStripeSale(session());
    await recordStripeSale(session({ id: "cs_test_other" }));

    expect(fake.directChildren("sales").map((entry) => entry.path).sort()).toEqual([
      "sales/stripe_cs_test_a1B2c3D4",
      "sales/stripe_cs_test_other",
    ]);
  });

  it("treats a gRPC ALREADY_EXISTS (code 6) from the SDK as a duplicate too", async () => {
    vi.spyOn(fake, "runTransaction").mockRejectedValue(
      Object.assign(new Error("Document already exists"), { code: 6 }),
    );

    await expect(recordStripeSale(session())).resolves.toBe("duplicate");
  });

  it.each([
    [Object.assign(new Error("x"), { code: 6 }), true],
    [Object.assign(new Error("x"), { code: "already-exists" }), true],
    [new Error("6 ALREADY_EXISTS: Document already exists: projects/p/sales/stripe_x"), true],
    [new Error("4 DEADLINE_EXCEEDED"), false],
    [Object.assign(new Error("x"), { code: 10 }), false],
    ["ALREADY_EXISTS", false],
    [null, false],
    [undefined, false],
  ])("isAlreadyExistsError(%o) is %s", (error, expected) => {
    expect(isAlreadyExistsError(error)).toBe(expected);
  });
});

describe("recordStripeSale: cost of goods", () => {
  it("freezes the cost of every piece sold from pieces/{handle}", async () => {
    stockCatalog(product(), product({ handle: "aretes-sol", title: "Aretes Sol" }));
    seedCost("anillo-luna"); // 60_000
    seedCost("aretes-sol", { metal: 20_000, stones: 0, other: 0, labor: 5_000 }); // 25_000

    await recordStripeSale(
      session({ metadata: { handles: "anillo-luna,aretes-sol" }, amount_subtotal: 275_000 }),
    );

    expect(fake.get(SALE_PATH)).toMatchObject({
      costOfGoods: 85_000,
      costPending: false,
    });
  });

  it("marks the sale 'costo pendiente' when a piece has no cost recorded", async () => {
    stockCatalog(product(), product({ handle: "aretes-sol", title: "Aretes Sol" }));
    seedCost("anillo-luna");

    await recordStripeSale(session({ metadata: { handles: "anillo-luna,aretes-sol" } }));

    expect(fake.get(SALE_PATH)).toMatchObject({
      costOfGoods: 60_000,
      costPending: true,
    });
  });

  it("is pending, not free, when nothing has a cost yet", async () => {
    await recordStripeSale(session());

    expect(fake.get(SALE_PATH)).toMatchObject({ costOfGoods: 0, costPending: true });
  });
});

describe("recordStripeSale: items", () => {
  it("labels the chosen ring size and keeps the base price", async () => {
    stockCatalog(
      product({
        handle: "anillo-luna",
        options: { kind: "ringSize", values: ["6", "7", "8"] },
      }),
    );

    await recordStripeSale(
      session({ metadata: { handles: "anillo-luna", options: "anillo-luna:size=7" } }),
    );

    expect(fake.get(SALE_PATH)?.items).toEqual([
      { handle: "anillo-luna", title: "Anillo Luna", price: 185_000, option: "Talla 7" },
    ]);
  });

  it("prices a chain length like the checkout did: base price plus the catalog's surcharge", async () => {
    stockCatalog(
      product({
        handle: "dije-sol",
        title: "Dije Sol",
        price: { amount: 120_000, currency: "MXN" },
        options: {
          kind: "chainLength",
          values: [
            { lengthCm: 40, extra: 0 },
            { lengthCm: 50, extra: 15_000 },
          ],
        },
      }),
    );

    await recordStripeSale(
      session({
        metadata: { handles: "dije-sol", options: "dije-sol:chain=50" },
        amount_subtotal: 135_000,
      }),
    );

    expect(fake.get(SALE_PATH)?.items).toEqual([
      { handle: "dije-sol", title: "Dije Sol", price: 135_000, option: "Cadena 50 cm" },
    ]);
  });

  it("keeps what the shopper chose even if the catalog no longer offers it, without a surcharge", async () => {
    stockCatalog(
      product({
        handle: "dije-sol",
        title: "Dije Sol",
        options: { kind: "chainLength", values: [{ lengthCm: 40, extra: 0 }] },
      }),
    );

    await recordStripeSale(
      session({ metadata: { handles: "dije-sol", options: "dije-sol:chain=55" } }),
    );

    expect(fake.get(SALE_PATH)?.items).toEqual([
      { handle: "dije-sol", title: "Dije Sol", price: 185_000, option: "Cadena 55 cm" },
    ]);
  });

  it("keeps a piece the catalog no longer knows, with its handle as title and price 0", async () => {
    stockCatalog();

    await recordStripeSale(session({ metadata: { handles: "borrada" } }));

    expect(fake.get(SALE_PATH)?.items).toEqual([
      { handle: "borrada", title: "borrada", price: 0 },
    ]);
    // The money is on the sale itself, taken from the session.
    expect(fake.get(SALE_PATH)).toMatchObject({ subtotal: 185_000, total: 200_000 });
  });

  it("reads each distinct handle once, trimming blanks and repeats", async () => {
    stockCatalog(product(), product({ handle: "aretes-sol", title: "Aretes Sol" }));

    await recordStripeSale(
      session({ metadata: { handles: " anillo-luna , aretes-sol,,anillo-luna" } }),
    );

    expect(getProductByHandleMock).toHaveBeenCalledTimes(2);
    expect((fake.get(SALE_PATH)?.items as Array<{ handle: string }>).map((item) => item.handle)).toEqual([
      "anillo-luna",
      "aretes-sol",
    ]);
  });
});

describe("recordStripeSale: totals come from the session", () => {
  it("stores what the customer paid even when it differs from the catalog's arithmetic", async () => {
    await recordStripeSale(
      session({ amount_subtotal: 170_000, amount_total: 181_000, shipping_cost: { amount_total: 11_000 } }),
    );

    expect(fake.get(SALE_PATH)).toMatchObject({
      subtotal: 170_000,
      shipping: 11_000,
      total: 181_000,
      currency: "MXN",
    });
  });

  it("has zero shipping for a session without a shipping cost", async () => {
    await recordStripeSale(
      session({ shipping_cost: null, amount_total: 185_000 }),
    );

    expect(fake.get(SALE_PATH)).toMatchObject({ shipping: 0, total: 185_000 });
  });

  it("falls back to the items and the shipping when the session's own figures are unusable", async () => {
    await recordStripeSale(
      session({
        amount_subtotal: null,
        amount_total: null,
        shipping_cost: { amount_total: 15_000 },
      }),
    );

    expect(fake.get(SALE_PATH)).toMatchObject({
      subtotal: 185_000,
      shipping: 15_000,
      total: 200_000,
    });
  });

  it("never stores a negative, fractional or non-numeric amount", async () => {
    await recordStripeSale(
      session({
        amount_subtotal: -5,
        amount_total: 1.5,
        shipping_cost: { amount_total: Number.NaN },
      }),
    );

    expect(fake.get(SALE_PATH)).toMatchObject({
      subtotal: 185_000,
      shipping: 0,
      total: 185_000,
    });
  });

  it("is always MXN, whatever a payload says: the shop is MXN-only", async () => {
    await recordStripeSale({ ...session(), currency: "usd" } as never);

    expect(fake.get(SALE_PATH)?.currency).toBe("MXN");
  });

  it("uses the time it is recorded when the session has no created time", async () => {
    const before = Date.now();

    await recordStripeSale(session({ created: null }));

    const recorded = (fake.get(SALE_PATH)?.date as FakeTimestamp).toDate().getTime();
    expect(recorded).toBeGreaterThanOrEqual(before);
    expect(recorded).toBeLessThanOrEqual(Date.now());
  });
});

describe("recordStripeSale: nothing to record, nothing writable", () => {
  it("answers 'unconfigured' before touching the catalog or Firestore when Firebase is not set up", async () => {
    configured = false;

    await expect(recordStripeSale(session())).resolves.toBe("unconfigured");

    expect(getProductByHandleMock).not.toHaveBeenCalled();
    expect(fake.committed).toHaveLength(0);
  });

  it.each([
    ["no pieces in the metadata", { metadata: { handles: "" } }],
    ["no metadata at all", { metadata: null }],
    ["metadata without handles", { metadata: { other: "x" } }],
    ["no session id", { id: undefined }],
    ["a blank session id", { id: "" }],
    ["a session id that could address another path", { id: "cs/../../x" }],
  ])("skips a session with %s", async (_label, patch) => {
    await expect(recordStripeSale(session(patch))).resolves.toBe("skipped");

    expect(getProductByHandleMock).not.toHaveBeenCalled();
    expect(fake.committed).toHaveLength(0);
  });

  it("rejects when the catalog cannot be read, writing nothing, so the caller can ask Stripe to retry", async () => {
    getProductByHandleMock.mockRejectedValue(new Error("network down"));

    await expect(recordStripeSale(session())).rejects.toThrow("network down");

    expect(fake.committed).toHaveLength(0);
  });

  it("rejects on a real Firestore failure instead of reporting a sale that was not written", async () => {
    vi.spyOn(fake, "runTransaction").mockRejectedValue(new Error("4 DEADLINE_EXCEEDED"));

    await expect(recordStripeSale(session())).rejects.toThrow("DEADLINE_EXCEEDED");

    expect(fake.get(SALE_PATH)).toBeUndefined();
  });
});

describe("recordStripeSale: no customer data", () => {
  // A real Checkout Session carries the buyer's details. The recorder must not
  // be able to copy any of it, whatever the object it is handed holds.
  const PII = {
    customer_details: {
      email: "ana.perez@example.com",
      name: "Ana Pérez",
      phone: "+525512345678",
      address: { line1: "Calle Falsa 123", city: "Guadalajara", postal_code: "44100" },
    },
    customer_email: "ana.perez@example.com",
    shipping_details: { name: "Ana Pérez", address: { line1: "Calle Falsa 123" } },
    customer: "cus_123",
    payment_intent: "pi_123",
  };

  it("stores only the documented fields", async () => {
    seedCost("anillo-luna");

    await recordStripeSale({ ...session(), ...PII } as never);

    const stored = fake.get(SALE_PATH) ?? {};
    expect(Object.keys(stored).sort()).toEqual(
      [
        "costOfGoods",
        "costPending",
        "createdAt",
        "currency",
        "date",
        "items",
        "shipping",
        "source",
        "status",
        "stripeSessionId",
        "subtotal",
        "total",
      ].sort(),
    );
  });

  it("holds no email, name, address, phone or customer id anywhere in what was written", async () => {
    await recordStripeSale({ ...session(), ...PII } as never);

    const everything = JSON.stringify([fake.get(SALE_PATH), fake.committed]);
    for (const fragment of [
      "ana.perez",
      "Ana",
      "Pérez",
      "5512345678",
      "Calle Falsa",
      "Guadalajara",
      "44100",
      "cus_123",
      "pi_123",
    ]) {
      expect(everything).not.toContain(fragment);
    }
  });
});
