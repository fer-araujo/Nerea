import { afterEach, describe, expect, it, vi } from "vitest";

// Every collaborator is mocked so this file tests exactly checkoutAction's
// own branching (availability guard -> Stripe call -> redirect), decoupled
// from next-intl's pathname formatting, Next's request-scoped headers(), and
// the real Stripe SDK — those are each other modules' own concerns.
const getAvailabilityMock = vi.fn();
const createCheckoutSessionMock = vi.fn();
const redirectMock = vi.fn();

vi.mock("@/lib/commerce", () => ({
  commerce: {
    getAvailability: (...args: unknown[]) => getAvailabilityMock(...args),
  },
}));

vi.mock("@/lib/commerce/stripe/checkout", () => ({
  createCheckoutSession: (...args: unknown[]) => createCheckoutSessionMock(...args),
}));

vi.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => redirectMock(...args),
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: "nerea-test.example" }),
}));

vi.mock("@/i18n/navigation", () => ({
  getPathname: ({ href, locale }: { href: string; locale: string }) =>
    `/${locale}${href}`,
}));

import { checkoutAction } from "@/lib/cart/checkout";
import type { CartLineItem } from "@/lib/cart/cart-context";

const LINE: CartLineItem = {
  handle: "anillo-plata-cera-perdida",
  title: "Anillo de plata fundido a la cera perdida",
  price: { amount: 185000, currency: "MXN" },
  image: "",
  quantity: 1,
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("checkoutAction — sold guard", () => {
  it("blocks the Stripe call and reports the sold handles when any handle is not available", async () => {
    getAvailabilityMock.mockResolvedValue({ [LINE.handle]: "sold" });

    const result = await checkoutAction([LINE], "es");

    expect(result).toEqual({
      ok: false,
      reason: "sold",
      soldHandles: [LINE.handle],
    });
    expect(createCheckoutSessionMock).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
  });
});

describe("checkoutAction — all available", () => {
  it("calls createCheckoutSession with mapped lines and redirects to the returned URL", async () => {
    getAvailabilityMock.mockResolvedValue({ [LINE.handle]: "available" });
    createCheckoutSessionMock.mockResolvedValue(
      "https://checkout.stripe.com/c/test_session",
    );

    await checkoutAction([LINE], "es");

    expect(createCheckoutSessionMock).toHaveBeenCalledWith(
      [{ name: LINE.title, amount: LINE.price.amount, quantity: LINE.quantity }],
      {
        // No `x-forwarded-proto` header is mocked and the host isn't
        // localhost, so resolveOrigin()'s fallback correctly picks "https".
        successUrl: "https://nerea-test.example/es/checkout/success",
        cancelUrl: "https://nerea-test.example/es/shop",
      },
    );
    expect(redirectMock).toHaveBeenCalledWith(
      "https://checkout.stripe.com/c/test_session",
    );
  });
});

describe("checkoutAction — Stripe failure", () => {
  it("returns a retryable error without throwing when session creation fails", async () => {
    getAvailabilityMock.mockResolvedValue({ [LINE.handle]: "available" });
    createCheckoutSessionMock.mockRejectedValue(new Error("network down"));

    await expect(checkoutAction([LINE], "es")).resolves.toEqual({
      ok: false,
      reason: "checkout-failed",
    });
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("also fails safe (no throw) when the availability re-check itself errors", async () => {
    getAvailabilityMock.mockRejectedValue(new Error("commerce backend down"));

    await expect(checkoutAction([LINE], "es")).resolves.toEqual({
      ok: false,
      reason: "checkout-failed",
    });
    expect(createCheckoutSessionMock).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
