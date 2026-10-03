import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// getStripeClient is mocked entirely (rather than the raw `stripe` package)
// so this file tests exactly one thing: createCheckoutSession's own
// line-item mapping (name/centavos/currency/quantity), decoupled from the
// SDK's HTTP layer. The mock IS the SDK surface this module actually calls.
const getStripeClientMock = vi.fn();
const createMock = vi.fn();

vi.mock("@/lib/commerce/stripe/client", () => ({
  getStripeClient: () => getStripeClientMock(),
}));

import { createCheckoutSession } from "@/lib/commerce/stripe/checkout";

const OPTIONS = {
  successUrl: "https://nerea.example/es/checkout/success",
  cancelUrl: "https://nerea.example/es/shop",
  shippingFee: 0,
  locale: "es" as const,
};

// What every session now carries on top of the line items: a Mexican shipping
// address, a phone number and one flat rate. With a 0 fee (OPTIONS above) the
// rate is free.
const FREE_SHIPPING_PARAMS = {
  shipping_address_collection: { allowed_countries: ["MX"] },
  phone_number_collection: { enabled: true },
  shipping_options: [
    {
      shipping_rate_data: {
        type: "fixed_amount",
        fixed_amount: { amount: 0, currency: "mxn" },
        display_name: "Envío gratis",
      },
    },
  ],
};

beforeEach(() => {
  getStripeClientMock.mockReturnValue({
    checkout: { sessions: { create: createMock } },
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("createCheckoutSession — line item mapping", () => {
  it("maps a single cart line to a Stripe line item: name, centavos, mxn currency, quantity", async () => {
    createMock.mockResolvedValueOnce({
      url: "https://checkout.stripe.com/c/test_123",
    });

    const url = await createCheckoutSession(
      [{ name: "Anillo de plata fundido a la cera perdida", amount: 185000, quantity: 1 }],
      OPTIONS,
    );

    expect(url).toBe("https://checkout.stripe.com/c/test_123");
    expect(createMock).toHaveBeenCalledWith({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "mxn",
            product_data: { name: "Anillo de plata fundido a la cera perdida" },
            unit_amount: 185000,
          },
          quantity: 1,
        },
      ],
      ...FREE_SHIPPING_PARAMS,
      success_url: OPTIONS.successUrl,
      cancel_url: OPTIONS.cancelUrl,
    });
  });

  it("maps multiple lines, preserving each line's own name/amount/quantity independently", async () => {
    createMock.mockResolvedValueOnce({
      url: "https://checkout.stripe.com/c/test_456",
    });

    await createCheckoutSession(
      [
        { name: "Anillo de plata fundido a la cera perdida", amount: 185000, quantity: 1 },
        { name: 'Aretes de plata "fase lunar"', amount: 95000, quantity: 1 },
      ],
      OPTIONS,
    );

    const call = createMock.mock.calls[0][0];
    expect(call.line_items).toHaveLength(2);
    expect(call.line_items[0]).toEqual({
      price_data: {
        currency: "mxn",
        product_data: { name: "Anillo de plata fundido a la cera perdida" },
        unit_amount: 185000,
      },
      quantity: 1,
    });
    expect(call.line_items[1]).toEqual({
      price_data: {
        currency: "mxn",
        product_data: { name: 'Aretes de plata "fase lunar"' },
        unit_amount: 95000,
      },
      quantity: 1,
    });
  });

  it("always forces currency to 'mxn', never reading a currency from the caller", async () => {
    createMock.mockResolvedValueOnce({ url: "https://checkout.stripe.com/c/test_789" });

    await createCheckoutSession([{ name: "x", amount: 1000, quantity: 1 }], OPTIONS);

    const call = createMock.mock.calls[0][0];
    expect(call.line_items[0].price_data.currency).toBe("mxn");
  });
});

const ONE_LINE = [{ name: "x", amount: 1000, quantity: 1 }];

// Pay before sell: the webhook sells a piece only once its payment is
// confirmed, and a one-of-one piece must not wait in limbo on a delayed
// voucher. So the session is card-only, set HERE rather than left to whatever
// the Stripe Dashboard's payment-method settings happen to say.
describe("createCheckoutSession — card only", () => {
  beforeEach(() => {
    createMock.mockResolvedValue({ url: "https://checkout.stripe.com/c/test_card" });
  });

  it("asks Stripe for card payments and nothing else", async () => {
    await createCheckoutSession(ONE_LINE, OPTIONS);

    expect(createMock.mock.calls[0][0].payment_method_types).toEqual(["card"]);
  });

  it("is card-only whatever else the session carries: fee, metadata, locale", async () => {
    await createCheckoutSession(ONE_LINE, {
      ...OPTIONS,
      shippingFee: 15000,
      locale: "en",
      handles: ["anillo-luna"],
      options: [{ handle: "anillo-luna", option: { kind: "ringSize", value: "7" } }],
    });

    expect(createMock.mock.calls[0][0].payment_method_types).toEqual(["card"]);
  });

  it("offers no way for the caller to widen it", async () => {
    await createCheckoutSession(ONE_LINE, {
      ...OPTIONS,
      // Not part of the options type: a stray value must not be picked up.
      payment_method_types: ["oxxo", "customer_balance"],
    } as typeof OPTIONS);

    expect(createMock.mock.calls[0][0].payment_method_types).toEqual(["card"]);
  });
});

describe("createCheckoutSession — shipping and phone collection", () => {
  beforeEach(() => {
    createMock.mockResolvedValue({ url: "https://checkout.stripe.com/c/test_ship" });
  });

  it("collects a Mexico-only shipping address and a phone number", async () => {
    await createCheckoutSession(ONE_LINE, OPTIONS);

    const call = createMock.mock.calls[0][0];
    expect(call.shipping_address_collection).toEqual({
      allowed_countries: ["MX"],
    });
    expect(call.phone_number_collection).toEqual({ enabled: true });
  });

  it("offers a single fixed-amount rate priced from the fee, in mxn centavos", async () => {
    await createCheckoutSession(ONE_LINE, { ...OPTIONS, shippingFee: 15000 });

    expect(createMock.mock.calls[0][0].shipping_options).toEqual([
      {
        shipping_rate_data: {
          type: "fixed_amount",
          fixed_amount: { amount: 15000, currency: "mxn" },
          display_name: "Envío",
        },
      },
    ]);
  });

  it("localizes the rate name for English", async () => {
    await createCheckoutSession(ONE_LINE, {
      ...OPTIONS,
      shippingFee: 15000,
      locale: "en",
    });

    expect(
      createMock.mock.calls[0][0].shipping_options[0].shipping_rate_data
        .display_name,
    ).toBe("Shipping");
  });

  it.each([
    ["es", "Envío gratis"],
    ["en", "Free shipping"],
  ] as const)("names a zero-fee rate for %s as free shipping", async (locale, name) => {
    await createCheckoutSession(ONE_LINE, { ...OPTIONS, shippingFee: 0, locale });

    const rate = createMock.mock.calls[0][0].shipping_options[0].shipping_rate_data;
    expect(rate.display_name).toBe(name);
    expect(rate.fixed_amount).toEqual({ amount: 0, currency: "mxn" });
  });

  // getShippingFee passes a present-but-non-number value through untouched
  // (it only defaults null/undefined to 0), so this guard is what stops a
  // mistyped Studio value from silently becoming free shipping.
  it.each<[string, number]>([
    ["negative", -100],
    ["fractional", 150.5],
    ["NaN", Number.NaN],
    ["a non-number", "150" as unknown as number],
  ])("refuses to create a session when the fee is %s", async (_label, fee) => {
    await expect(
      createCheckoutSession(ONE_LINE, { ...OPTIONS, shippingFee: fee }),
    ).rejects.toThrow();
    expect(createMock).not.toHaveBeenCalled();
  });
});

describe("createCheckoutSession — metadata", () => {
  beforeEach(() => {
    createMock.mockResolvedValue({ url: "https://checkout.stripe.com/c/test_meta" });
  });

  it("attaches comma-joined handles, with no options key when none were chosen", async () => {
    await createCheckoutSession(ONE_LINE, {
      ...OPTIONS,
      handles: ["anillo", "aretes"],
    });

    expect(createMock.mock.calls[0][0].metadata).toEqual({
      handles: "anillo,aretes",
    });
  });

  it("attaches options as comma-joined handle:size / handle:chain pairs", async () => {
    await createCheckoutSession(ONE_LINE, {
      ...OPTIONS,
      handles: ["anillo", "dije"],
      options: [
        { handle: "anillo", option: { kind: "ringSize", value: "7.5" } },
        { handle: "dije", option: { kind: "chainLength", lengthCm: 45 } },
      ],
    });

    expect(createMock.mock.calls[0][0].metadata).toEqual({
      handles: "anillo,dije",
      options: "anillo:size=7.5,dije:chain=45",
    });
  });

  it("truncates metadata.options at 500 characters, since the option is also in the line name", async () => {
    const options = Array.from({ length: 60 }, (_, index) => ({
      handle: `pieza-con-un-nombre-largo-${index}`,
      option: { kind: "ringSize" as const, value: "7" },
    }));
    const fullOptions = options
      .map((entry) => `${entry.handle}:size=7`)
      .join(",");
    expect(fullOptions.length).toBeGreaterThan(500);

    // Short handles on purpose: only the options list overflows here.
    await createCheckoutSession(ONE_LINE, {
      ...OPTIONS,
      handles: ["pieza-0"],
      options,
    });

    const { metadata } = createMock.mock.calls[0][0];
    expect(metadata.options).toHaveLength(500);
    expect(metadata.options).toBe(fullOptions.slice(0, 500));
    expect(metadata.handles).toBe("pieza-0");
  });

  // The webhook marks sold ONLY the handles it finds in metadata.handles, so
  // a silently truncated list would leave a paid one-of-one piece purchasable
  // again. Over the cap must fail closed, before any session is created.
  it("throws instead of truncating when the joined handles exceed 500 characters", async () => {
    const handles = Array.from(
      { length: 60 },
      (_, index) => `pieza-con-un-nombre-largo-${index}`,
    );
    expect(handles.join(",").length).toBeGreaterThan(500);

    await expect(
      createCheckoutSession(ONE_LINE, { ...OPTIONS, handles }),
    ).rejects.toThrow(/metadata limit/);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("accepts handles that join to exactly 500 characters, and rejects one more", async () => {
    await createCheckoutSession(ONE_LINE, {
      ...OPTIONS,
      handles: ["a".repeat(500)],
    });
    expect(createMock.mock.calls[0][0].metadata.handles).toHaveLength(500);

    await expect(
      createCheckoutSession(ONE_LINE, {
        ...OPTIONS,
        handles: ["a".repeat(501)],
      }),
    ).rejects.toThrow();
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("leaves metadata out entirely when there are no handles and no options", async () => {
    await createCheckoutSession(ONE_LINE, OPTIONS);
    await createCheckoutSession(ONE_LINE, { ...OPTIONS, handles: [], options: [] });

    expect(createMock.mock.calls[0][0]).not.toHaveProperty("metadata");
    expect(createMock.mock.calls[1][0]).not.toHaveProperty("metadata");
  });
});

describe("createCheckoutSession — failure paths", () => {
  it("throws when Stripe does not return a session URL", async () => {
    createMock.mockResolvedValueOnce({ url: null });

    await expect(
      createCheckoutSession([{ name: "x", amount: 1000, quantity: 1 }], OPTIONS),
    ).rejects.toThrow();
  });

  it("throws when Stripe is not configured (getStripeClient returns undefined)", async () => {
    getStripeClientMock.mockReturnValueOnce(undefined);

    await expect(
      createCheckoutSession([{ name: "x", amount: 1000, quantity: 1 }], OPTIONS),
    ).rejects.toThrow();
    expect(createMock).not.toHaveBeenCalled();
  });

  it("propagates a Stripe SDK/network rejection to the caller", async () => {
    createMock.mockRejectedValueOnce(new Error("network down"));

    await expect(
      createCheckoutSession([{ name: "x", amount: 1000, quantity: 1 }], OPTIONS),
    ).rejects.toThrow("network down");
  });
});
