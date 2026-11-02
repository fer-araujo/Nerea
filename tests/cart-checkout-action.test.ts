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
import { resolveProductOptions } from "@/lib/commerce/options";
import type { Product } from "@/lib/commerce/types";

const ORIGINAL_ENV = { ...process.env };

const LINE: CartLineItem = {
  handle: "anillo-plata-cera-perdida",
  title: "Anillo de plata fundido a la cera perdida",
  price: { amount: 185000, currency: "MXN" },
  cover: null,
  quantity: 1,
  stock: 1,
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
  stock: 1,
  cover: null,
  media: [],
  description: "",
  options: { kind: "none" },
};

beforeEach(() => {
  getProductByHandleMock.mockResolvedValue(SERVER_PRODUCT);
  // Free shipping by default — only the tests about the fee override this.
  getShippingFeeMock.mockResolvedValue(0);
  // Payments are on by default: the action refuses outright without a Stripe
  // key. Placeholder only — the Stripe module itself is mocked here.
  process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.clearAllMocks();
});

describe("checkoutAction — payments gate", () => {
  // A Server Action is a public endpoint, so the gate cannot live only in the
  // drawer: with no key the action must stop before it reads Sanity or builds
  // a Stripe session.
  it.each([
    ["unset", undefined],
    ["empty", ""],
  ])(
    "refuses with payments-disabled, touching nothing, when the Stripe key is %s",
    async (_label, key) => {
      if (key === undefined) {
        delete process.env.STRIPE_SECRET_KEY;
      } else {
        process.env.STRIPE_SECRET_KEY = key;
      }

      const result = await checkoutAction([LINE], "es");

      expect(result).toEqual({ ok: false, reason: "payments-disabled" });
      expect(getAvailabilityMock).not.toHaveBeenCalled();
      expect(getProductByHandleMock).not.toHaveBeenCalled();
      expect(getShippingFeeMock).not.toHaveBeenCalled();
      expect(createCheckoutSessionMock).not.toHaveBeenCalled();
      expect(redirectMock).not.toHaveBeenCalled();
    },
  );
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

// The storefront caches the catalog for up to a minute (ISR). A cached
// "available" can outlive a sale, so the two reads that gate money must bypass
// it: otherwise a one-of-one piece that just sold could still reach Stripe.
describe("checkoutAction — fresh catalog reads", () => {
  it("re-checks availability with an uncached read", async () => {
    getAvailabilityMock.mockResolvedValue({ [LINE.handle]: "available" });
    createCheckoutSessionMock.mockResolvedValue("https://checkout.stripe.com/c/s");

    await checkoutAction([LINE], "es");

    expect(getAvailabilityMock).toHaveBeenCalledTimes(1);
    expect(getAvailabilityMock).toHaveBeenCalledWith([LINE.handle], { fresh: true });
  });

  it("re-prices every handle with an uncached read", async () => {
    const other: CartLineItem = { ...LINE, handle: "aretes-luna" };
    getAvailabilityMock.mockResolvedValue({
      [LINE.handle]: "available",
      [other.handle]: "available",
    });
    createCheckoutSessionMock.mockResolvedValue("https://checkout.stripe.com/c/s");

    await checkoutAction([LINE, other], "es");

    expect(getProductByHandleMock).toHaveBeenCalledTimes(2);
    expect(getProductByHandleMock).toHaveBeenCalledWith(LINE.handle, "es", { fresh: true });
    expect(getProductByHandleMock).toHaveBeenCalledWith(other.handle, "es", { fresh: true });
  });

  it("does not let a piece the uncached read reports as sold through, whatever the page showed", async () => {
    // What the (cached) shop page may still say is irrelevant: only the
    // uncached answer decides.
    getAvailabilityMock.mockImplementation(
      async (_handles: string[], options?: { fresh?: boolean }) => ({
        [LINE.handle]: options?.fresh ? "sold" : "available",
      }),
    );

    const result = await checkoutAction([LINE], "es");

    expect(result).toEqual({ ok: false, reason: "sold", soldHandles: [LINE.handle] });
    expect(createCheckoutSessionMock).not.toHaveBeenCalled();
  });
});

describe("checkoutAction — server-side re-pricing", () => {
  it("re-prices from the authoritative catalog and ignores a tampered client price/title/stock, then redirects to the returned URL", async () => {
    // Deliberately tampered: a forged near-zero price, an inflated stock
    // figure, and a spoofed title. None of this may reach Stripe — only
    // `handle`, `option` and `quantity` are read from this object, and the
    // last two only as claims to validate.
    const tamperedLine: CartLineItem = {
      handle: LINE.handle,
      title: "HACKED TITLE",
      price: { amount: 1, currency: "MXN" },
      cover: null,
      quantity: 1,
      stock: 99,
    };
    getAvailabilityMock.mockResolvedValue({ [LINE.handle]: "available" });
    getProductByHandleMock.mockResolvedValue(SERVER_PRODUCT);
    createCheckoutSessionMock.mockResolvedValue(
      "https://checkout.stripe.com/c/test_session",
    );

    await checkoutAction([tamperedLine], "es");

    expect(getProductByHandleMock).toHaveBeenCalledWith(LINE.handle, "es", {
      fresh: true,
    });
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
        successUrl:
          "https://nerea-test.example/es/checkout/success?session_id={CHECKOUT_SESSION_ID}",
        cancelUrl: "https://nerea-test.example/es/shop",
        shippingFee: 0,
        locale: "es",
        // Forwarded so the Stripe webhook can map the payment back to
        // Sanity docs (app/api/stripe/webhook/route.ts).
        handles: [LINE.handle],
        // What was bought, with quantities: what the webhook sells from.
        items: [{ handle: LINE.handle, quantity: 1 }],
        // A piece with no option contributes none.
        options: [],
      },
    );
    expect(redirectMock).toHaveBeenCalledWith(
      "https://checkout.stripe.com/c/test_session",
    );
  });

  it("adds a repeated identical line into a single Stripe line item, once per handle", async () => {
    getAvailabilityMock.mockResolvedValue({ [LINE.handle]: "available" });
    getProductByHandleMock.mockResolvedValue({ ...SERVER_PRODUCT, stock: 5 });
    createCheckoutSessionMock.mockResolvedValue(
      "https://checkout.stripe.com/c/test_session",
    );

    await checkoutAction([LINE, LINE], "es");

    expect(getProductByHandleMock).toHaveBeenCalledTimes(1);
    const call = createCheckoutSessionMock.mock.calls[0];
    expect(call[0]).toEqual([
      { name: SERVER_PRODUCT.title, amount: SERVER_PRODUCT.price.amount, quantity: 2 },
    ]);
    expect(call[1].handles).toEqual([LINE.handle]);
    expect(call[1].items).toEqual([{ handle: LINE.handle, quantity: 2 }]);
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
  stock: 1,
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

    expect(getProductByHandleMock).toHaveBeenCalledWith(LINE.handle, "en", {
      fresh: true,
    });
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

  it("rejects a repeated handle when ANY of its lines has an invalid option", async () => {
    getProductByHandleMock.mockResolvedValue({ ...RING_PRODUCT, stock: 5 });

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

// A piece's kind of option can come from its CATEGORY (a piece that never set
// its own, or says "Según la categoría"). The action must validate against
// exactly what the catalog resolved — built here with the real resolver, as the
// Sanity adapter does — not against anything the cart claims.
describe("checkoutAction — option resolved from the category", () => {
  const inheritedFrom = (categoryPurchaseOption: string | undefined): Product => ({
    ...SERVER_PRODUCT,
    options: resolveProductOptions({
      purchaseOption: undefined,
      categoryPurchaseOption,
    }),
  });

  beforeEach(() => {
    getAvailabilityMock.mockImplementation(async (handles: string[]) =>
      Object.fromEntries(handles.map((handle) => [handle, "available"])),
    );
    createCheckoutSessionMock.mockResolvedValue(
      "https://checkout.stripe.com/c/test_session",
    );
  });

  it("asks for a size on a piece that inherits a ring category: a line without one is rejected", async () => {
    getProductByHandleMock.mockResolvedValue(inheritedFrom("ringSize"));

    const result = await checkoutAction([LINE], "es");

    expect(result).toEqual({
      ok: false,
      reason: "invalid-option",
      handles: [LINE.handle],
    });
    expect(createCheckoutSessionMock).not.toHaveBeenCalled();
  });

  it("accepts a size from the resolved list and sends only the validated copy to Stripe", async () => {
    getProductByHandleMock.mockResolvedValue(inheritedFrom("ringSize"));

    await checkoutAction(
      [
        {
          ...LINE,
          option: {
            kind: "ringSize",
            value: "7.5",
            extra: -100000,
          } as CartLineItem["option"],
        },
      ],
      "es",
    );

    const [lines, session] = createCheckoutSessionMock.mock.calls[0];
    expect(lines).toEqual([
      {
        name: `${SERVER_PRODUCT.title} — Talla 7.5`,
        amount: SERVER_PRODUCT.price.amount,
        quantity: 1,
      },
    ]);
    expect(session.options).toEqual([
      { handle: LINE.handle, option: { kind: "ringSize", value: "7.5" } },
    ]);
    expect(redirectMock).toHaveBeenCalledWith(
      "https://checkout.stripe.com/c/test_session",
    );
  });

  it.each<[string, unknown]>([
    ["a size outside the resolved list", { kind: "ringSize", value: "99" }],
    ["a chain length on an inherited ring", { kind: "chainLength", lengthCm: 45 }],
  ])("rejects %s", async (_label, option) => {
    getProductByHandleMock.mockResolvedValue(inheritedFrom("ringSize"));

    const result = await checkoutAction(
      [{ ...LINE, option } as unknown as CartLineItem],
      "es",
    );

    expect(result).toEqual({
      ok: false,
      reason: "invalid-option",
      handles: [LINE.handle],
    });
    expect(createCheckoutSessionMock).not.toHaveBeenCalled();
  });

  it("validates a chain length against an inherited chain category, charging the catalog's extra", async () => {
    getProductByHandleMock.mockResolvedValue(inheritedFrom("chainLength"));

    await checkoutAction(
      [{ ...LINE, option: { kind: "chainLength", lengthCm: 45 } }],
      "es",
    );

    expect(createCheckoutSessionMock.mock.calls[0][0]).toEqual([
      {
        name: `${SERVER_PRODUCT.title} — Cadena 45 cm`,
        amount: SERVER_PRODUCT.price.amount,
        quantity: 1,
      },
    ]);
  });

  it("takes no option when the piece has no category (or its category has none): a size sent is rejected", async () => {
    for (const categoryOption of [undefined, "none"]) {
      createCheckoutSessionMock.mockClear();
      getProductByHandleMock.mockResolvedValue(inheritedFrom(categoryOption));

      const rejected = await checkoutAction(
        [{ ...LINE, option: { kind: "ringSize", value: "7" } }],
        "es",
      );
      expect(rejected).toEqual({
        ok: false,
        reason: "invalid-option",
        handles: [LINE.handle],
      });
      expect(createCheckoutSessionMock).not.toHaveBeenCalled();

      await checkoutAction([LINE], "es");
      expect(createCheckoutSessionMock).toHaveBeenCalledTimes(1);
    }
  });

  it("lets an explicit none on the piece beat a ring category: no option is asked for", async () => {
    getProductByHandleMock.mockResolvedValue({
      ...SERVER_PRODUCT,
      options: resolveProductOptions({
        purchaseOption: "none",
        categoryPurchaseOption: "ringSize",
      }),
    });

    await checkoutAction([LINE], "es");

    expect(createCheckoutSessionMock).toHaveBeenCalledTimes(1);
    expect(createCheckoutSessionMock.mock.calls[0][1].options).toEqual([]);
  });
});

// A design can be made in several copies. The server is the authority on how
// many there are: it reads the stock uncached and refuses a cart that asks for
// more, whatever the client's own copy of the number says.
describe("checkoutAction — quantities and stock", () => {
  const stocked = (stock: number, product: Product = SERVER_PRODUCT): Product => ({
    ...product,
    stock,
  });

  beforeEach(() => {
    getAvailabilityMock.mockImplementation(async (handles: string[]) =>
      Object.fromEntries(handles.map((handle) => [handle, "available"])),
    );
    createCheckoutSessionMock.mockResolvedValue(
      "https://checkout.stripe.com/c/test_session",
    );
  });

  it("sends the line's quantity to Stripe at the catalog price, and the items to the webhook", async () => {
    getProductByHandleMock.mockResolvedValue(stocked(5));

    await checkoutAction([{ ...LINE, quantity: 3, stock: 5 }], "es");

    const [lines, session] = createCheckoutSessionMock.mock.calls[0];
    expect(lines).toEqual([
      {
        name: SERVER_PRODUCT.title,
        amount: SERVER_PRODUCT.price.amount,
        quantity: 3,
      },
    ]);
    expect(session.handles).toEqual([LINE.handle]);
    expect(session.items).toEqual([{ handle: LINE.handle, quantity: 3 }]);
    expect(redirectMock).toHaveBeenCalledWith(
      "https://checkout.stripe.com/c/test_session",
    );
  });

  it("lets a cart take exactly the stock", async () => {
    getProductByHandleMock.mockResolvedValue(stocked(2));

    await checkoutAction([{ ...LINE, quantity: 2 }], "es");

    expect(createCheckoutSessionMock).toHaveBeenCalledTimes(1);
    expect(createCheckoutSessionMock.mock.calls[0][0][0].quantity).toBe(2);
  });

  it("answers insufficient-stock, with what IS available, when the cart asks for one more than the shop has", async () => {
    getProductByHandleMock.mockResolvedValue(stocked(2));

    const result = await checkoutAction(
      // The client's own stock figure is a stale lie: only the live read counts.
      [{ ...LINE, quantity: 3, stock: 10 }],
      "es",
    );

    expect(result).toEqual({
      ok: false,
      reason: "insufficient-stock",
      items: [{ handle: LINE.handle, available: 2 }],
    });
    expect(createCheckoutSessionMock).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("counts every line of one piece (each size) against the same stock", async () => {
    getProductByHandleMock.mockResolvedValue(stocked(3, RING_PRODUCT));

    const result = await checkoutAction(
      [
        { ...LINE, quantity: 2, option: { kind: "ringSize", value: "6" } },
        { ...LINE, quantity: 2, option: { kind: "ringSize", value: "7" } },
      ],
      "es",
    );

    expect(result).toEqual({
      ok: false,
      reason: "insufficient-stock",
      items: [{ handle: LINE.handle, available: 3 }],
    });
    expect(createCheckoutSessionMock).not.toHaveBeenCalled();
  });

  it("makes each (piece, option) its own Stripe line item with its own quantity", async () => {
    getProductByHandleMock.mockResolvedValue(stocked(5, RING_PRODUCT));

    await checkoutAction(
      [
        { ...LINE, quantity: 2, option: { kind: "ringSize", value: "6" } },
        { ...LINE, quantity: 1, option: { kind: "ringSize", value: "7" } },
      ],
      "es",
    );

    const [lines, session] = createCheckoutSessionMock.mock.calls[0];
    expect(lines).toEqual([
      { name: `${RING_PRODUCT.title} — Talla 6`, amount: 185000, quantity: 2 },
      { name: `${RING_PRODUCT.title} — Talla 7`, amount: 185000, quantity: 1 },
    ]);
    expect(session.handles).toEqual([LINE.handle]);
    expect(session.items).toEqual([
      { handle: LINE.handle, quantity: 2, option: { kind: "ringSize", value: "6" } },
      { handle: LINE.handle, quantity: 1, option: { kind: "ringSize", value: "7" } },
    ]);
    expect(session.options).toEqual([
      { handle: LINE.handle, option: { kind: "ringSize", value: "6" } },
      { handle: LINE.handle, option: { kind: "ringSize", value: "7" } },
    ]);
  });

  it("merges lines that name the same option, whatever extra fields they carry", async () => {
    getProductByHandleMock.mockResolvedValue(stocked(5, RING_PRODUCT));

    await checkoutAction(
      [
        { ...LINE, quantity: 1, option: { kind: "ringSize", value: "7" } },
        {
          ...LINE,
          quantity: 2,
          option: { kind: "ringSize", value: "7", extra: -5 } as CartLineItem["option"],
        },
      ],
      "es",
    );

    const [lines, session] = createCheckoutSessionMock.mock.calls[0];
    expect(lines).toEqual([
      { name: `${RING_PRODUCT.title} — Talla 7`, amount: 185000, quantity: 3 },
    ]);
    expect(session.items).toEqual([
      { handle: LINE.handle, quantity: 3, option: { kind: "ringSize", value: "7" } },
    ]);
  });

  it("charges the catalog's extra on EVERY unit of an option line", async () => {
    getProductByHandleMock.mockResolvedValue(stocked(4, PENDANT_PRODUCT));

    await checkoutAction([{ ...PENDANT_LINE, quantity: 2 }], "es");

    expect(createCheckoutSessionMock.mock.calls[0][0]).toEqual([
      {
        name: "Dije de oro con amatista — Cadena 50 cm",
        amount: 420000 + 15000,
        quantity: 2,
      },
    ]);
  });

  it("reports every piece that is short, and only those", async () => {
    const byHandle: Record<string, Product> = {
      "anillo-a": { ...SERVER_PRODUCT, handle: "anillo-a", stock: 1 },
      "anillo-b": { ...SERVER_PRODUCT, handle: "anillo-b", stock: 4 },
      "anillo-c": { ...SERVER_PRODUCT, handle: "anillo-c", stock: 2 },
    };
    getProductByHandleMock.mockImplementation(
      async (handle: string) => byHandle[handle],
    );

    const result = await checkoutAction(
      [
        { ...LINE, handle: "anillo-a", quantity: 2 },
        { ...LINE, handle: "anillo-b", quantity: 4 },
        { ...LINE, handle: "anillo-c", quantity: 3 },
      ],
      "es",
    );

    expect(result).toEqual({
      ok: false,
      reason: "insufficient-stock",
      items: [
        { handle: "anillo-a", available: 1 },
        { handle: "anillo-c", available: 2 },
      ],
    });
  });

  it("reports a piece with no stock as sold, not as insufficient", async () => {
    getProductByHandleMock.mockResolvedValue(stocked(0));

    const result = await checkoutAction([{ ...LINE, quantity: 2 }], "es");

    expect(result).toEqual({
      ok: false,
      reason: "sold",
      soldHandles: [LINE.handle],
    });
  });

  it("does not trust a product read that carries no usable stock", async () => {
    getProductByHandleMock.mockResolvedValue({
      ...SERVER_PRODUCT,
      stock: undefined,
    } as unknown as Product);

    const result = await checkoutAction([LINE], "es");

    expect(result).toEqual({
      ok: false,
      reason: "sold",
      soldHandles: [LINE.handle],
    });
    expect(createCheckoutSessionMock).not.toHaveBeenCalled();
  });

  it("reports sold before insufficient-stock, and insufficient-stock before invalid-option", async () => {
    const byHandle: Record<string, Product> = {
      vendida: { ...SERVER_PRODUCT, handle: "vendida", availability: "sold", stock: 0 },
      corta: { ...SERVER_PRODUCT, handle: "corta", stock: 1 },
      anillo: { ...RING_PRODUCT, handle: "anillo", stock: 3 },
    };
    getProductByHandleMock.mockImplementation(
      async (handle: string) => byHandle[handle],
    );
    const lines: CartLineItem[] = [
      { ...LINE, handle: "anillo" }, // needs a size it does not have
      { ...LINE, handle: "corta", quantity: 2 },
      { ...LINE, handle: "vendida" },
    ];

    expect(await checkoutAction(lines, "es")).toEqual({
      ok: false,
      reason: "sold",
      soldHandles: ["vendida"],
    });
    expect(await checkoutAction(lines.slice(0, 2), "es")).toEqual({
      ok: false,
      reason: "insufficient-stock",
      items: [{ handle: "corta", available: 1 }],
    });
    expect(await checkoutAction(lines.slice(0, 1), "es")).toEqual({
      ok: false,
      reason: "invalid-option",
      handles: ["anillo"],
    });
  });

  it.each<[string, unknown]>([
    ["zero", 0],
    ["negative", -1],
    ["fractional", 1.5],
    ["NaN", Number.NaN],
    ["a string", "2"],
    ["missing", undefined],
    ["null", null],
    ["unsafe", Number.MAX_SAFE_INTEGER + 2],
  ])(
    "refuses a tampered quantity (%s) as a failed checkout, before reading anything",
    async (_label, quantity) => {
      const tampered = { ...LINE, quantity } as unknown as CartLineItem;

      await expect(checkoutAction([tampered], "es")).resolves.toEqual({
        ok: false,
        reason: "checkout-failed",
      });
      expect(getAvailabilityMock).not.toHaveBeenCalled();
      expect(getProductByHandleMock).not.toHaveBeenCalled();
      expect(createCheckoutSessionMock).not.toHaveBeenCalled();
    },
  );

  it("reads the stock uncached, like the availability", async () => {
    getProductByHandleMock.mockResolvedValue(stocked(2));

    await checkoutAction([{ ...LINE, quantity: 2 }], "es");

    expect(getProductByHandleMock).toHaveBeenCalledWith(LINE.handle, "es", {
      fresh: true,
    });
  });

  it("fails closed, creating no session, when the items would not fit Stripe's metadata", async () => {
    getProductByHandleMock.mockResolvedValue(stocked(2));
    createCheckoutSessionMock.mockRejectedValue(
      new Error("Purchased items exceed Stripe's metadata limit."),
    );

    await expect(checkoutAction([LINE], "es")).resolves.toEqual({
      ok: false,
      reason: "checkout-failed",
    });
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("does not read the shipping fee when the stock is short", async () => {
    getProductByHandleMock.mockResolvedValue(stocked(1));

    await checkoutAction([{ ...LINE, quantity: 2 }], "es");

    expect(getShippingFeeMock).not.toHaveBeenCalled();
  });
});

// A Server Action is a public endpoint, so the size of the cart is the caller's
// to choose. It is bounded BEFORE any catalog read: 50 lines, 99 units a line.
describe("checkoutAction — cart size limits", () => {
  const linesOf = (count: number): CartLineItem[] =>
    Array.from({ length: count }, (_, index) => ({
      ...LINE,
      handle: `pieza-${index}`,
    }));

  beforeEach(() => {
    getAvailabilityMock.mockImplementation(async (handles: string[]) =>
      Object.fromEntries(handles.map((handle) => [handle, "available"])),
    );
    getProductByHandleMock.mockImplementation(async (handle: string) => ({
      ...SERVER_PRODUCT,
      handle,
      stock: 99,
    }));
    createCheckoutSessionMock.mockResolvedValue(
      "https://checkout.stripe.com/c/test_session",
    );
  });

  function expectNothingRead() {
    expect(getAvailabilityMock).not.toHaveBeenCalled();
    expect(getProductByHandleMock).not.toHaveBeenCalled();
    expect(getShippingFeeMock).not.toHaveBeenCalled();
    expect(createCheckoutSessionMock).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
  }

  it("takes a cart of exactly 50 lines", async () => {
    await checkoutAction(linesOf(50), "es");

    expect(getProductByHandleMock).toHaveBeenCalledTimes(50);
    expect(createCheckoutSessionMock).toHaveBeenCalledTimes(1);
  });

  it("refuses 51 lines with a typed result, before any catalog read", async () => {
    const result = await checkoutAction(linesOf(51), "es");

    expect(result).toEqual({ ok: false, reason: "cart-too-large" });
    expectNothingRead();
  });

  it("counts LINES, not distinct pieces: 51 lines of one piece are too many", async () => {
    const result = await checkoutAction(
      Array.from({ length: 51 }, () => LINE),
      "es",
    );

    expect(result).toEqual({ ok: false, reason: "cart-too-large" });
    expectNothingRead();
  });

  it("refuses an absurd number of lines without even looking at them", async () => {
    const lines = linesOf(5_000);
    const touched = vi.fn();
    // A getter would fire if the action iterated a line's fields.
    for (const line of lines) {
      Object.defineProperty(line, "handle", { get: () => touched() ?? "x" });
    }

    const result = await checkoutAction(lines, "es");

    expect(result).toEqual({ ok: false, reason: "cart-too-large" });
    expect(touched).not.toHaveBeenCalled();
    expectNothingRead();
  });

  it("takes a line of exactly 99 units (when the shop has them)", async () => {
    await checkoutAction([{ ...LINE, quantity: 99 }], "es");

    expect(createCheckoutSessionMock).toHaveBeenCalledTimes(1);
    expect(createCheckoutSessionMock.mock.calls[0][0][0].quantity).toBe(99);
  });

  it("refuses a line of 100 units with a typed result, before any catalog read", async () => {
    const result = await checkoutAction([{ ...LINE, quantity: 100 }], "es");

    expect(result).toEqual({ ok: false, reason: "cart-too-large" });
    expectNothingRead();
  });

  it("refuses the whole cart when ONE of its lines is over the limit", async () => {
    const result = await checkoutAction(
      [LINE, { ...LINE, handle: "otra", quantity: 100 }],
      "es",
    );

    expect(result).toEqual({ ok: false, reason: "cart-too-large" });
    expectNothingRead();
  });

  it("is not the same as insufficient stock: 100 units is too large even when the shop has 1000", async () => {
    getProductByHandleMock.mockResolvedValue({ ...SERVER_PRODUCT, stock: 1000 });

    const result = await checkoutAction([{ ...LINE, quantity: 100 }], "es");

    expect(result).toMatchObject({ reason: "cart-too-large" });
    expect(getProductByHandleMock).not.toHaveBeenCalled();
  });

  it("answers a failed checkout, reading nothing, when the lines are not even a list", async () => {
    const result = await checkoutAction(
      { length: 1, 0: LINE } as unknown as CartLineItem[],
      "es",
    );

    expect(result).toEqual({ ok: false, reason: "checkout-failed" });
    expectNothingRead();
  });

  it("still validates a quantity that is not a whole number as a failed checkout, not as too large", async () => {
    const result = await checkoutAction([{ ...LINE, quantity: 1.5 }], "es");

    expect(result).toEqual({ ok: false, reason: "checkout-failed" });
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
        successUrl:
          "https://nerea.example/es/checkout/success?session_id={CHECKOUT_SESSION_ID}",
        cancelUrl: "https://nerea.example/es/shop",
      }),
    );
  });
});

describe("checkoutAction — success URL", () => {
  async function successUrlFor(locale: "es" | "en"): Promise<string> {
    getAvailabilityMock.mockResolvedValue({ [LINE.handle]: "available" });
    createCheckoutSessionMock.mockResolvedValue(
      "https://checkout.stripe.com/c/test_session",
    );

    await checkoutAction([LINE], locale);

    return createCheckoutSessionMock.mock.calls[0][1].successUrl as string;
  }

  it("carries Stripe's session id placeholder, so the success page can tell a real return", async () => {
    const successUrl = await successUrlFor("es");

    expect(successUrl).toContain("?session_id={CHECKOUT_SESSION_ID}");
    // The cancel URL is a plain page: nothing to substitute there.
    expect(createCheckoutSessionMock.mock.calls[0][1].cancelUrl).not.toContain(
      "session_id",
    );
  });

  it("keeps the placeholder literal: percent-encoded braces are not substituted by Stripe", async () => {
    const successUrl = await successUrlFor("en");

    expect(successUrl).toBe(
      "https://nerea-test.example/en/checkout/success?session_id={CHECKOUT_SESSION_ID}",
    );
    expect(successUrl).not.toMatch(/%7B|%7D/i);
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
