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
