import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Every collaborator is mocked so this file tests exactly checkoutAction's
// own branching (availability guard -> re-pricing fetch -> Stripe call ->
// redirect), decoupled from next-intl's pathname formatting, Next's
// request-scoped headers(), and the real Stripe SDK — those are each other
// modules' own concerns.
const getAvailabilityMock = vi.fn();
const getProductByHandleMock = vi.fn();
const createCheckoutSessionMock = vi.fn();
const getShippingFeeMock = vi.fn();
const redirectMock = vi.fn();

vi.mock("@/lib/commerce", () => ({
  commerce: {
    getAvailability: (...args: unknown[]) => getAvailabilityMock(...args),
    getProductByHandle: (...args: unknown[]) => getProductByHandleMock(...args),
  },
}));

// The shipping fee is read from the site settings (Sanity) — mocked so these
// tests stay credential-free and can drive free / paid / unreadable fees.
vi.mock("@/lib/site-settings/adapter", () => ({
  getShippingFee: (...args: unknown[]) => getShippingFeeMock(...args),
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
  options: { kind: "none" },
};

beforeEach(() => {
  getProductByHandleMock.mockResolvedValue(SERVER_PRODUCT);
  // Free shipping by default — only the tests about the fee override this.
  getShippingFeeMock.mockResolvedValue(0);
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
        shippingFee: 0,
        locale: "es",
        // Forwarded so the Stripe webhook can map the payment back to
        // Sanity docs (app/api/stripe/webhook/route.ts).
        handles: [LINE.handle],
        // A piece with no option contributes none.
        options: [],
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

// The catalog is the only source of truth for a piece's options AND for the
// surcharge each one carries. These pin that a client-supplied option is only
// ever a claim: validated against the catalog, never trusted for its price.
const RING_PRODUCT: Product = {
  ...SERVER_PRODUCT,
  options: { kind: "ringSize", values: ["6", "7", "8"] },
};

const PENDANT_HANDLE = "dije-oro-amatista";
const PENDANT_PRODUCT: Product = {
  ...SERVER_PRODUCT,
  handle: PENDANT_HANDLE,
  title: "Dije de oro con amatista",
  price: { amount: 420000, currency: "MXN" },
  options: {
    kind: "chainLength",
    values: [
      { lengthCm: 40, extra: 0 },
      { lengthCm: 50, extra: 15000 },
    ],
  },
};

const PENDANT_LINE: CartLineItem = {
  handle: PENDANT_HANDLE,
  title: PENDANT_PRODUCT.title,
  price: PENDANT_PRODUCT.price,
  cover: null,
  quantity: 1,
  option: { kind: "chainLength", lengthCm: 50 },
};

describe("checkoutAction — purchase options", () => {
  beforeEach(() => {
    getAvailabilityMock.mockImplementation(async (handles: string[]) =>
      Object.fromEntries(handles.map((handle) => [handle, "available"])),
    );
    createCheckoutSessionMock.mockResolvedValue(
      "https://checkout.stripe.com/c/test_session",
    );
  });

  it("rejects a piece that needs a size when the line has none, without creating a session", async () => {
    getProductByHandleMock.mockResolvedValue(RING_PRODUCT);

    const result = await checkoutAction([LINE], "es");

    expect(result).toEqual({
      ok: false,
      reason: "invalid-option",
      handles: [LINE.handle],
    });
    expect(createCheckoutSessionMock).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it.each<[string, unknown]>([
    ["an unknown size", { kind: "ringSize", value: "99" }],
    ["a size the catalog removed", { kind: "ringSize", value: "5" }],
    ["a non-string size", { kind: "ringSize", value: 7 }],
    ["a chain option on a ring", { kind: "chainLength", lengthCm: 45 }],
    ["a malformed option", { kind: "ringSize" }],
  ])("rejects %s as invalid-option", async (_label, option) => {
    getProductByHandleMock.mockResolvedValue(RING_PRODUCT);

    // A tampered payload is by definition outside the declared type.
    const tampered = { ...LINE, option } as unknown as CartLineItem;
    const result = await checkoutAction([tampered], "es");

    expect(result).toEqual({
      ok: false,
      reason: "invalid-option",
      handles: [LINE.handle],
    });
    expect(createCheckoutSessionMock).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("rejects an option sent for a piece that takes none", async () => {
    getProductByHandleMock.mockResolvedValue(SERVER_PRODUCT);

    const result = await checkoutAction(
      [{ ...LINE, option: { kind: "ringSize", value: "7" } }],
      "es",
    );

    expect(result).toEqual({
      ok: false,
      reason: "invalid-option",
      handles: [LINE.handle],
    });
    expect(createCheckoutSessionMock).not.toHaveBeenCalled();
  });

  it("charges the catalog price PLUS the catalog extra, ignoring a client price and a client-claimed extra", async () => {
    getProductByHandleMock.mockResolvedValue(PENDANT_PRODUCT);

    await checkoutAction(
      [
        {
          ...PENDANT_LINE,
          price: { amount: 1, currency: "MXN" },
          // Not part of the type: what a tampered payload could carry.
          option: {
            kind: "chainLength",
            lengthCm: 50,
            extra: 0,
            extraPrice: 0,
          } as CartLineItem["option"],
        },
      ],
      "es",
    );

    const [lines, session] = createCheckoutSessionMock.mock.calls[0];
    expect(lines).toEqual([
      {
        name: "Dije de oro con amatista — Cadena 50 cm",
        amount: 420000 + 15000,
        quantity: 1,
      },
    ]);
    // What reaches Stripe is the validated copy, without the forged fields.
    expect(session.options).toEqual([
      {
        handle: PENDANT_HANDLE,
        option: { kind: "chainLength", lengthCm: 50 },
      },
    ]);
  });

  it("keeps the base price for a length with no extra", async () => {
    getProductByHandleMock.mockResolvedValue(PENDANT_PRODUCT);

    await checkoutAction(
      [{ ...PENDANT_LINE, option: { kind: "chainLength", lengthCm: 40 } }],
      "es",
    );

    expect(createCheckoutSessionMock.mock.calls[0][0]).toEqual([
      {
        name: "Dije de oro con amatista — Cadena 40 cm",
        amount: 420000,
        quantity: 1,
      },
    ]);
  });

  it("names the Stripe line with the option, localized", async () => {
    getProductByHandleMock.mockResolvedValue(RING_PRODUCT);

    await checkoutAction(
      [{ ...LINE, option: { kind: "ringSize", value: "7" } }],
      "en",
    );

    expect(getProductByHandleMock).toHaveBeenCalledWith(LINE.handle, "en");
    expect(createCheckoutSessionMock.mock.calls[0][0]).toEqual([
      {
        name: `${RING_PRODUCT.title} — Size 7`,
        amount: RING_PRODUCT.price.amount,
        quantity: 1,
      },
    ]);
  });

  it("passes only the validated options through, per handle, leaving option-less pieces out", async () => {
    const byHandle: Record<string, Product> = {
      [LINE.handle]: RING_PRODUCT,
      aretes: { ...SERVER_PRODUCT, handle: "aretes" },
    };
    getProductByHandleMock.mockImplementation(
      async (handle: string) => byHandle[handle],
    );

    await checkoutAction(
      [
        { ...LINE, option: { kind: "ringSize", value: "8" } },
        { ...LINE, handle: "aretes", title: "Aretes" },
      ],
      "es",
    );

    const [lines, session] = createCheckoutSessionMock.mock.calls[0];
    expect(lines).toHaveLength(2);
    expect(session.handles).toEqual([LINE.handle, "aretes"]);
    expect(session.options).toEqual([
      { handle: LINE.handle, option: { kind: "ringSize", value: "8" } },
    ]);
  });

  it("validates the FIRST line's option when a handle is repeated", async () => {
    getProductByHandleMock.mockResolvedValue(RING_PRODUCT);

    const result = await checkoutAction(
      [LINE, { ...LINE, option: { kind: "ringSize", value: "7" } }],
      "es",
    );

    expect(result).toEqual({
      ok: false,
      reason: "invalid-option",
      handles: [LINE.handle],
    });
  });

  it("reports every piece whose option is invalid, and only those", async () => {
    const byHandle: Record<string, Product> = {
      "anillo-a": { ...RING_PRODUCT, handle: "anillo-a" },
      "anillo-b": { ...RING_PRODUCT, handle: "anillo-b" },
      "anillo-c": { ...RING_PRODUCT, handle: "anillo-c" },
    };
    getProductByHandleMock.mockImplementation(
      async (handle: string) => byHandle[handle],
    );

    const result = await checkoutAction(
      [
        { ...LINE, handle: "anillo-a", option: { kind: "ringSize", value: "99" } },
        { ...LINE, handle: "anillo-b" },
        { ...LINE, handle: "anillo-c", option: { kind: "ringSize", value: "7" } },
      ],
      "es",
    );

    // The valid piece (c) is not reported, so it stays in the client cart.
    expect(result).toEqual({
      ok: false,
      reason: "invalid-option",
      handles: ["anillo-a", "anillo-b"],
    });
    expect(createCheckoutSessionMock).not.toHaveBeenCalled();
  });

  it("reports a sold piece before an invalid option", async () => {
    const byHandle: Record<string, Product> = {
      [LINE.handle]: RING_PRODUCT,
      vendida: { ...SERVER_PRODUCT, handle: "vendida", availability: "sold" },
    };
    getProductByHandleMock.mockImplementation(
      async (handle: string) => byHandle[handle],
    );

    const result = await checkoutAction(
      [LINE, { ...LINE, handle: "vendida" }],
      "es",
    );

    expect(result).toEqual({
      ok: false,
      reason: "sold",
      soldHandles: ["vendida"],
    });
    expect(createCheckoutSessionMock).not.toHaveBeenCalled();
  });

  it("still blocks a piece whose catalog price is invalid, even with a valid option", async () => {
    getProductByHandleMock.mockResolvedValue({
      ...PENDANT_PRODUCT,
      price: { amount: 0, currency: "MXN" },
    });

    const result = await checkoutAction([PENDANT_LINE], "es");

    expect(result).toEqual({
      ok: false,
      reason: "sold",
      soldHandles: [PENDANT_HANDLE],
    });
    expect(createCheckoutSessionMock).not.toHaveBeenCalled();
  });
});

describe("checkoutAction — shipping fee", () => {
  beforeEach(() => {
    getAvailabilityMock.mockResolvedValue({ [LINE.handle]: "available" });
    createCheckoutSessionMock.mockResolvedValue(
      "https://checkout.stripe.com/c/test_session",
    );
  });

  it("reads the fee from the site settings and passes it to Stripe", async () => {
    getShippingFeeMock.mockResolvedValue(15000);

    await checkoutAction([LINE], "es");

    expect(getShippingFeeMock).toHaveBeenCalledTimes(1);
    expect(createCheckoutSessionMock.mock.calls[0][1]).toMatchObject({
      shippingFee: 15000,
      locale: "es",
    });
  });

  it("never lets the client pick the fee", async () => {
    getShippingFeeMock.mockResolvedValue(15000);

    await checkoutAction(
      [{ ...LINE, shippingFee: 0 } as CartLineItem],
      "es",
    );

    expect(createCheckoutSessionMock.mock.calls[0][1].shippingFee).toBe(15000);
  });

  it("fails closed when the fee cannot be read, instead of defaulting to free shipping", async () => {
    getShippingFeeMock.mockRejectedValue(new Error("settings unreachable"));

    await expect(checkoutAction([LINE], "es")).resolves.toEqual({
      ok: false,
      reason: "checkout-failed",
    });
    expect(createCheckoutSessionMock).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("does not read the fee at all when the cart is rejected earlier", async () => {
    getAvailabilityMock.mockResolvedValue({ [LINE.handle]: "sold" });

    await checkoutAction([LINE], "es");

    expect(getShippingFeeMock).not.toHaveBeenCalled();
  });
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
