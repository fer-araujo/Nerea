import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Every collaborator is mocked so this file tests exactly checkoutAction's
// own branching (availability guard -> re-pricing fetch -> Stripe call ->
// redirect), decoupled from next-intl's pathname formatting, Next's
// request-scoped headers(), and the real Stripe SDK — those are each other
// modules' own concerns.
const getAvailabilityMock = vi.fn();
const getProductByHandleMock = vi.fn();
const createCheckoutSessionMock = vi.fn();
const redirectMock = vi.fn();

vi.mock("@/lib/commerce", () => ({
  commerce: {
    getAvailability: (...args: unknown[]) => getAvailabilityMock(...args),
    getProductByHandle: (...args: unknown[]) => getProductByHandleMock(...args),
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
import type { Product } from "@/lib/commerce/types";

const ORIGINAL_ENV = { ...process.env };

const LINE: CartLineItem = {
  handle: "anillo-plata-cera-perdida",
  title: "Anillo de plata fundido a la cera perdida",
  price: { amount: 185000, currency: "MXN" },
  cover: null,
  quantity: 1,
};

// The authoritative server-side product for LINE.handle — what
// commerce.getProductByHandle returns. Used as the default "happy path"
// resolution for every test that doesn't specifically exercise a
// null/sold re-pricing outcome.
const SERVER_PRODUCT: Product = {
  handle: LINE.handle,
  title: LINE.title,
  price: LINE.price,
  availability: "available",
  cover: null,
  media: [],
  description: "",
};

beforeEach(() => {
  getProductByHandleMock.mockResolvedValue(SERVER_PRODUCT);
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
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
    // Short-circuits before the (more expensive) re-pricing fetch.
    expect(getProductByHandleMock).not.toHaveBeenCalled();
    expect(createCheckoutSessionMock).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
  });
});

describe("checkoutAction — server-side re-pricing", () => {
  it("re-prices from the authoritative catalog and ignores a tampered client price/title/quantity, then redirects to the returned URL", async () => {
    // Deliberately tampered: a forged near-zero price, an inflated
    // quantity, and a spoofed title. None of this may reach Stripe — only
    // `handle` is trusted from this object.
    const tamperedLine: CartLineItem = {
      handle: LINE.handle,
      title: "HACKED TITLE",
      price: { amount: 1, currency: "MXN" },
      cover: null,
      quantity: 99,
    };
    getAvailabilityMock.mockResolvedValue({ [LINE.handle]: "available" });
    getProductByHandleMock.mockResolvedValue(SERVER_PRODUCT);
    createCheckoutSessionMock.mockResolvedValue(
      "https://checkout.stripe.com/c/test_session",
    );

    await checkoutAction([tamperedLine], "es");

    expect(getProductByHandleMock).toHaveBeenCalledWith(LINE.handle, "es");
    expect(createCheckoutSessionMock).toHaveBeenCalledWith(
      [
        {
          name: SERVER_PRODUCT.title,
          amount: SERVER_PRODUCT.price.amount,
          quantity: 1,
        },
      ],
      {
        // No `x-forwarded-proto` header is mocked, the host isn't
        // localhost, and NEXT_PUBLIC_SITE_URL is unset, so resolveOrigin()'s
        // header-based fallback correctly picks "https".
        successUrl: "https://nerea-test.example/es/checkout/success",
        cancelUrl: "https://nerea-test.example/es/shop",
        // Forwarded so the Stripe webhook can map the payment back to
        // Sanity docs (app/api/stripe/webhook/route.ts).
        handles: [LINE.handle],
      },
    );
    expect(redirectMock).toHaveBeenCalledWith(
      "https://checkout.stripe.com/c/test_session",
    );
  });

  it("dedupes a repeated handle into a single Stripe line item", async () => {
    getAvailabilityMock.mockResolvedValue({ [LINE.handle]: "available" });
    createCheckoutSessionMock.mockResolvedValue(
      "https://checkout.stripe.com/c/test_session",
    );

    await checkoutAction([LINE, LINE], "es");

    expect(getProductByHandleMock).toHaveBeenCalledTimes(1);
    const call = createCheckoutSessionMock.mock.calls[0];
    expect(call[0]).toHaveLength(1);
    expect(call[1].handles).toEqual([LINE.handle]);
  });

  it("blocks checkout without creating a session when the handle is unknown to the catalog", async () => {
    getAvailabilityMock.mockResolvedValue({ [LINE.handle]: "available" });
    getProductByHandleMock.mockResolvedValue(null);

    const result = await checkoutAction([LINE], "es");

    expect(result).toEqual({
      ok: false,
      reason: "sold",
      soldHandles: [LINE.handle],
    });
    expect(createCheckoutSessionMock).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("blocks checkout when the freshly-fetched product is sold, even though the availability pre-check said available", async () => {
    getAvailabilityMock.mockResolvedValue({ [LINE.handle]: "available" });
    getProductByHandleMock.mockResolvedValue({
      ...SERVER_PRODUCT,
      availability: "sold",
    });

    const result = await checkoutAction([LINE], "es");

    expect(result).toEqual({
      ok: false,
      reason: "sold",
      soldHandles: [LINE.handle],
    });
    expect(createCheckoutSessionMock).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  // A Sanity piece with a missing/blank price coalesces to 0 at the query
  // boundary (lib/commerce/sanity/queries.ts). This guard is the only thing
  // standing between that and a $0 Stripe line, so pin every invalid shape.
  it.each([
    ["zero", 0],
    ["negative", -500],
    ["non-integer", 1.5],
  ])(
    "blocks checkout without creating a session when the server price is %s",
    async (_label, amount) => {
      getAvailabilityMock.mockResolvedValue({ [LINE.handle]: "available" });
      getProductByHandleMock.mockResolvedValue({
        ...SERVER_PRODUCT,
        price: { ...SERVER_PRODUCT.price, amount },
      });

      const result = await checkoutAction([LINE], "es");

      expect(result).toEqual({
        ok: false,
        reason: "sold",
        soldHandles: [LINE.handle],
      });
      expect(createCheckoutSessionMock).not.toHaveBeenCalled();
      expect(redirectMock).not.toHaveBeenCalled();
    },
  );
});

describe("checkoutAction — resolveOrigin", () => {
  it("prefers NEXT_PUBLIC_SITE_URL over the request Host header when set, stripping a trailing slash", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://nerea.example/";
    getAvailabilityMock.mockResolvedValue({ [LINE.handle]: "available" });
    createCheckoutSessionMock.mockResolvedValue(
      "https://checkout.stripe.com/c/test_session",
    );

    await checkoutAction([LINE], "es");

    expect(createCheckoutSessionMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        successUrl: "https://nerea.example/es/checkout/success",
        cancelUrl: "https://nerea.example/es/shop",
      }),
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
    expect(getProductByHandleMock).not.toHaveBeenCalled();
    expect(createCheckoutSessionMock).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("also fails safe (no throw) when the re-pricing fetch itself errors", async () => {
    getAvailabilityMock.mockResolvedValue({ [LINE.handle]: "available" });
    getProductByHandleMock.mockRejectedValue(new Error("commerce backend down"));

    await expect(checkoutAction([LINE], "es")).resolves.toEqual({
      ok: false,
      reason: "checkout-failed",
    });
    expect(createCheckoutSessionMock).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
