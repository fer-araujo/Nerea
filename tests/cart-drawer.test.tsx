// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import esMessages from "../messages/es.json";
import enMessages from "../messages/en.json";
import { MotionProvider } from "../components/motion/MotionProvider";
import {
  CART_STORAGE_KEY,
  CartProvider,
  useCart,
  type CartLineItem,
} from "../lib/cart/cart-context";
import { checkoutAction } from "../lib/cart/checkout";
import { CartDrawer } from "../components/layout/CartDrawer";

// checkoutAction is out of scope for this file (covered by
// tests/cart-checkout-action.test.ts) — mocked so CartDrawer can be exercised
// without next/headers or next/navigation request context. Individual tests
// script its result to drive the drawer's error branches.
vi.mock("../lib/cart/checkout", () => ({
  checkoutAction: vi.fn(),
}));

const checkoutActionMock = vi.mocked(checkoutAction);

// ITEM_A is a design made in several copies (5 in stock); ITEM_B is a
// one-of-one piece (1 in stock).
const ITEM_A: Omit<CartLineItem, "quantity"> = {
  handle: "anillo-plata-cera-perdida",
  title: "Anillo de plata fundido a la cera perdida",
  price: { amount: 185000, currency: "MXN" },
  cover: null,
  stock: 5,
};

const ITEM_B: Omit<CartLineItem, "quantity"> = {
  handle: "aretes-plata-luna",
  title: 'Aretes de plata "fase lunar"',
  price: { amount: 95000, currency: "MXN" },
  cover: null,
  stock: 1,
};

// The same ring in two sizes, and the same pendant on two chains — the
// pendant's 50 cm chain carries a $150.00 extra already folded into the
// line's display price, exactly as PurchasePanel builds it.
const RING_7: Omit<CartLineItem, "quantity"> = {
  ...ITEM_A,
  option: { kind: "ringSize", value: "7" },
};
const RING_8: Omit<CartLineItem, "quantity"> = {
  ...ITEM_A,
  option: { kind: "ringSize", value: "8" },
};
const PENDANT_45: Omit<CartLineItem, "quantity"> = {
  handle: "dije-oro-amatista",
  title: "Dije de oro con amatista",
  price: { amount: 420000, currency: "MXN" },
  cover: null,
  stock: 2,
  option: { kind: "chainLength", lengthCm: 45 },
};
const PENDANT_50: Omit<CartLineItem, "quantity"> = {
  ...PENDANT_45,
  price: { amount: 435000, currency: "MXN" },
  option: { kind: "chainLength", lengthCm: 50 },
};

// Stand-in for AcquireButton/CartTrigger — exercises the same `useCart()`
// surface those real components call, scoped to what this file needs.
const HARNESS_ITEMS: Record<string, Omit<CartLineItem, "quantity">> = {
  "add-a": ITEM_A,
  "add-a-fewer": { ...ITEM_A, stock: 2 },
  "add-b": ITEM_B,
  "add-ring-7": RING_7,
  "add-ring-8": RING_8,
  "add-pendant-45": PENDANT_45,
  "add-pendant-50": PENDANT_50,
};

function TestHarness({
  paymentsEnabled,
  whatsappNumber,
}: {
  paymentsEnabled: boolean;
  whatsappNumber?: string;
}) {
  const { addItem, open, isOpen } = useCart();
  return (
    <>
      {Object.entries(HARNESS_ITEMS).map(([label, item]) => (
        <button key={label} type="button" onClick={() => addItem(item)}>
          {label}
        </button>
      ))}
      <button type="button" onClick={open}>
        open-drawer
      </button>
      {/* The cart's own open flag: readable at once, without waiting for the
          drawer's exit animation to finish. */}
      <span data-testid="cart-open">{String(isOpen)}</span>
      <CartDrawer
        paymentsEnabled={paymentsEnabled}
        whatsappNumber={whatsappNumber}
      />
    </>
  );
}

// Payments are on unless a test says otherwise, which is what the layout
// passes once a Stripe key is configured. The WhatsApp number is absent unless
// a test passes one (the layout passes it from the site settings).
function renderCart(paymentsEnabled = true, whatsappNumber?: string) {
  return render(
    <NextIntlClientProvider locale="es" messages={esMessages}>
      <MotionProvider>
        <CartProvider>
          <TestHarness
            paymentsEnabled={paymentsEnabled}
            whatsappNumber={whatsappNumber}
          />
        </CartProvider>
      </MotionProvider>
    </NextIntlClientProvider>,
  );
}

function storedCart(): CartLineItem[] {
  return JSON.parse(window.localStorage.getItem(CART_STORAGE_KEY) ?? "[]");
}

beforeEach(() => {
  window.localStorage.clear();
  checkoutActionMock.mockReset();
});

describe("CartDrawer — payments gate", () => {
  it("keeps the checkout button, and offers no reserve link, while payments are on", async () => {
    renderCart(true);
    fireEvent.click(screen.getByText("add-a"));
    await screen.findByText(ITEM_A.title);

    expect(
      screen.getByRole("button", { name: esMessages.Cart.checkout }),
    ).toBeInTheDocument();
    expect(screen.queryByText(esMessages.Cart.paymentsSoon)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: esMessages.Cart.reserveCta }),
    ).not.toBeInTheDocument();
  });

  it("keeps the subtotal but swaps the checkout button for a reserve-by-message link while payments are off", async () => {
    renderCart(false);
    fireEvent.click(screen.getByText("add-a"));
    await screen.findByText(ITEM_A.title);

    // The line's price and the subtotal.
    expect(screen.getByText(esMessages.Cart.subtotal)).toBeInTheDocument();
    expect(screen.getAllByText("$1,850.00")).toHaveLength(2);
    expect(screen.getByText(esMessages.Cart.paymentsSoon)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: esMessages.Cart.checkout }),
    ).not.toBeInTheDocument();

    const reserve = screen.getByRole("link", {
      name: esMessages.Cart.reserveCta,
    });
    expect(reserve.getAttribute("href")).toMatch(/\/contact$/);
    expect(checkoutActionMock).not.toHaveBeenCalled();
  });

  it("closes the drawer when the reserve link is followed", async () => {
    // jsdom cannot navigate: cancel the default after React's handlers ran,
    // so the click only exercises the drawer's own onClick.
    const blockNavigation = (event: Event) => event.preventDefault();
    document.addEventListener("click", blockNavigation);
    try {
      renderCart(false);
      fireEvent.click(screen.getByText("add-a"));
      await screen.findByText(ITEM_A.title);
      expect(screen.getByTestId("cart-open")).toHaveTextContent("true");

      fireEvent.click(
        screen.getByRole("link", { name: esMessages.Cart.reserveCta }),
      );

      expect(screen.getByTestId("cart-open")).toHaveTextContent("false");
    } finally {
      document.removeEventListener("click", blockNavigation);
    }
  });

  // The page can have been built with payments on and the key removed since:
  // the action then refuses, and the drawer must fall back to the same footer
  // instead of showing "try again" for something that cannot succeed.
  it("switches to the reserve-by-message footer when the server reports payments disabled", async () => {
    checkoutActionMock.mockResolvedValue({
      ok: false,
      reason: "payments-disabled",
    });
    renderCart(true);
    fireEvent.click(screen.getByText("add-a"));
    await screen.findByText(ITEM_A.title);

    fireEvent.click(
      screen.getByRole("button", { name: esMessages.Cart.checkout }),
    );

    expect(
      await screen.findByText(esMessages.Cart.paymentsSoon),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: esMessages.Cart.reserveCta }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: esMessages.Cart.checkout }),
    ).not.toBeInTheDocument();
    // The cart is untouched and no error banner is shown on top of the note.
    expect(screen.getByText(ITEM_A.title)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(storedCart().map((line) => line.handle)).toEqual([ITEM_A.handle]);
  });
});

describe("CartDrawer — WhatsApp in the payments gate", () => {
  const NUMBER = "5215512345678";

  it("adds WhatsApp as a secondary link under the reserve link while payments are off", async () => {
    renderCart(false, NUMBER);
    fireEvent.click(screen.getByText("add-a"));
    await screen.findByText(ITEM_A.title);

    const whatsapp = screen.getByRole("link", {
      name: esMessages.Cart.whatsappCta,
    });
    expect(whatsapp).toHaveAttribute(
      "href",
      `https://wa.me/${NUMBER}?text=${encodeURIComponent(esMessages.Cart.whatsappText)}`,
    );
    expect(whatsapp).toHaveAttribute("target", "_blank");
    expect(whatsapp).toHaveAttribute("rel", "noopener noreferrer");

    // The reserve-by-message link is still there, and still first.
    const reserve = screen.getByRole("link", {
      name: esMessages.Cart.reserveCta,
    });
    expect(
      reserve.compareDocumentPosition(whatsapp) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("leaves the drawer open when the WhatsApp link is followed (it opens in a new tab)", async () => {
    const blockNavigation = (event: Event) => event.preventDefault();
    document.addEventListener("click", blockNavigation);
    try {
      renderCart(false, NUMBER);
      fireEvent.click(screen.getByText("add-a"));
      await screen.findByText(ITEM_A.title);

      fireEvent.click(
        screen.getByRole("link", { name: esMessages.Cart.whatsappCta }),
      );

      expect(screen.getByTestId("cart-open")).toHaveTextContent("true");
    } finally {
      document.removeEventListener("click", blockNavigation);
    }
  });

  it.each([
    ["no number is set", undefined],
    ["the number is not usable", "12345"],
  ])("shows no WhatsApp link when %s", async (_label, number) => {
    renderCart(false, number);
    fireEvent.click(screen.getByText("add-a"));
    await screen.findByText(ITEM_A.title);

    expect(
      screen.queryByRole("link", { name: esMessages.Cart.whatsappCta }),
    ).not.toBeInTheDocument();
    // The reserve link is unaffected.
    expect(
      screen.getByRole("link", { name: esMessages.Cart.reserveCta }),
    ).toBeInTheDocument();
  });

  it("shows no WhatsApp link while payments are on, even with a number", async () => {
    renderCart(true, NUMBER);
    fireEvent.click(screen.getByText("add-a"));
    await screen.findByText(ITEM_A.title);

    expect(
      screen.queryByRole("link", { name: esMessages.Cart.whatsappCta }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: esMessages.Cart.checkout }),
    ).toBeInTheDocument();
  });

  it("offers WhatsApp too once the server reports payments disabled", async () => {
    checkoutActionMock.mockResolvedValue({
      ok: false,
      reason: "payments-disabled",
    });
    renderCart(true, NUMBER);
    fireEvent.click(screen.getByText("add-a"));
    await screen.findByText(ITEM_A.title);

    fireEvent.click(
      screen.getByRole("button", { name: esMessages.Cart.checkout }),
    );

    expect(
      await screen.findByRole("link", { name: esMessages.Cart.whatsappCta }),
    ).toBeInTheDocument();
  });
});

describe("CartDrawer — add and remove", () => {
  it("lists an added item, and removing it drops only that item from the list", async () => {
    renderCart();

    fireEvent.click(screen.getByText("add-a"));
    fireEvent.click(screen.getByText("add-b"));

    expect(await screen.findByText(ITEM_A.title)).toBeInTheDocument();
    expect(screen.getByText(ITEM_B.title)).toBeInTheDocument();

    const removeLabelA = esMessages.Cart.removeLabel.replace(
      "{title}",
      ITEM_A.title,
    );
    fireEvent.click(screen.getByRole("button", { name: removeLabelA }));

    expect(screen.queryByText(ITEM_A.title)).not.toBeInTheDocument();
    expect(screen.getByText(ITEM_B.title)).toBeInTheDocument();
  });
});

describe("CartDrawer — localStorage persistence", () => {
  it("restores previously saved items on mount, simulating a reload", async () => {
    window.localStorage.setItem(
      CART_STORAGE_KEY,
      JSON.stringify([{ ...ITEM_A, quantity: 1 }]),
    );

    renderCart();
    fireEvent.click(screen.getByText("open-drawer"));

    expect(await screen.findByText(ITEM_A.title)).toBeInTheDocument();
  });

  it("starts from an empty cart when localStorage has no saved cart", async () => {
    renderCart();
    fireEvent.click(screen.getByText("open-drawer"));

    expect(await screen.findByText(esMessages.Cart.empty)).toBeInTheDocument();
  });

  // One corrupted entry (a stray `null` is enough) used to throw while the
  // drawer read `item.handle`, breaking every page. Each malformed variant
  // below reuses ITEM_A's title, so its absence proves every one was dropped
  // while the single well-formed line (ITEM_B) survives.
  it("drops malformed stored lines instead of crashing, and keeps the valid ones", async () => {
    window.localStorage.setItem(
      CART_STORAGE_KEY,
      JSON.stringify([
        null,
        42,
        "anillo",
        {},
        { ...ITEM_A, quantity: 1, handle: "" },
        { ...ITEM_A, quantity: 1, handle: 7 },
        { ...ITEM_A, quantity: 1, title: null },
        { ...ITEM_A, quantity: 1, price: null },
        { ...ITEM_A, quantity: 1, price: { amount: "185000", currency: "MXN" } },
        // NaN / Infinity cannot survive JSON, they come back as null.
        { ...ITEM_A, quantity: 1, price: { amount: null, currency: "MXN" } },
        { ...ITEM_A, quantity: 1, price: { amount: 185000, currency: 5 } },
        // Cart arithmetic runs on quantity and stock: a bad one drops the line.
        { ...ITEM_A, quantity: 0 },
        { ...ITEM_A, quantity: -2 },
        { ...ITEM_A, quantity: 1.5 },
        { ...ITEM_A, quantity: "2" },
        { ...ITEM_A, quantity: null },
        { ...ITEM_A, quantity: undefined },
        { ...ITEM_A, quantity: 1, stock: 0 },
        { ...ITEM_A, quantity: 1, stock: 2.5 },
        { ...ITEM_A, quantity: 1, stock: "5" },
        { ...ITEM_A, quantity: 1, stock: undefined },
        { ...ITEM_B, quantity: 1 },
      ]),
    );

    renderCart();
    fireEvent.click(screen.getByText("open-drawer"));

    expect(await screen.findByText(ITEM_B.title)).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.queryByText(ITEM_A.title)).not.toBeInTheDocument();
  });
});

describe("cart v3 storage", () => {
  it("stores the cart under the v3 key", () => {
    expect(CART_STORAGE_KEY).toBe("nerea:cart:v3");
  });

  it.each(["nerea:cart:v1", "nerea:cart:v2"])(
    "ignores a %s cart, whose lines predate quantities and stock",
    async (key) => {
      window.localStorage.setItem(
        key,
        JSON.stringify([{ ...ITEM_A, quantity: 1 }]),
      );

      renderCart();
      fireEvent.click(screen.getByText("open-drawer"));

      expect(await screen.findByText(esMessages.Cart.empty)).toBeInTheDocument();
      expect(screen.queryByText(ITEM_A.title)).not.toBeInTheDocument();
    },
  );

  it("drops a v3-keyed line that lacks the stock (an old shape written by hand)", async () => {
    const withoutStock: Record<string, unknown> = { ...ITEM_A, quantity: 1 };
    delete withoutStock.stock;
    window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify([withoutStock]));

    renderCart();
    fireEvent.click(screen.getByText("open-drawer"));

    expect(await screen.findByText(esMessages.Cart.empty)).toBeInTheDocument();
  });

  it("persists the chosen option, the quantity and the stock on the line", async () => {
    renderCart();
    fireEvent.click(screen.getByText("add-ring-7"));
    await screen.findByText(ITEM_A.title);

    expect(storedCart()).toEqual([{ ...RING_7, quantity: 1 }]);
  });

  it("restores a saved option on mount", async () => {
    window.localStorage.setItem(
      CART_STORAGE_KEY,
      JSON.stringify([{ ...PENDANT_45, quantity: 1 }]),
    );

    renderCart();
    fireEvent.click(screen.getByText("open-drawer"));

    expect(await screen.findByText("Cadena 45 cm")).toBeInTheDocument();
  });

  it("restores a saved quantity on mount", async () => {
    window.localStorage.setItem(
      CART_STORAGE_KEY,
      JSON.stringify([{ ...ITEM_A, quantity: 3 }]),
    );

    renderCart();
    fireEvent.click(screen.getByText("open-drawer"));

    expect(await screen.findByText("× 3")).toBeInTheDocument();
  });
});

describe("CartDrawer — line identity and quantity", () => {
  it("raises the quantity when the same piece with the same option is added again", async () => {
    renderCart();

    fireEvent.click(screen.getByText("add-ring-7"));
    fireEvent.click(screen.getByText("add-ring-7"));

    expect(await screen.findByText("× 2")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(storedCart()).toEqual([{ ...RING_7, quantity: 2 }]);
  });

  it("makes a different option of the same piece a NEW line, keeping both", async () => {
    renderCart();

    fireEvent.click(screen.getByText("add-pendant-45"));
    fireEvent.click(screen.getByText("add-pendant-50"));

    expect(await screen.findByText("Cadena 45 cm")).toBeInTheDocument();
    expect(screen.getByText("Cadena 50 cm")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(storedCart().map((line) => [line.option, line.quantity])).toEqual([
      [{ kind: "chainLength", lengthCm: 45 }, 1],
      [{ kind: "chainLength", lengthCm: 50 }, 1],
    ]);
  });

  it("treats a piece without an option and the same piece with one as different lines", async () => {
    renderCart();

    fireEvent.click(screen.getByText("add-a"));
    fireEvent.click(screen.getByText("add-ring-7"));

    await screen.findByText("Talla 7");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("keeps a line's position and refreshes what it shows when the same line is added again", async () => {
    renderCart();

    fireEvent.click(screen.getByText("add-ring-7"));
    fireEvent.click(screen.getByText("add-b"));
    fireEvent.click(screen.getByText("add-ring-7"));

    await screen.findByText("× 2");
    expect(storedCart().map((line) => line.handle)).toEqual([
      ITEM_A.handle,
      ITEM_B.handle,
    ]);
  });

  it("shows the line total (price times quantity) and a subtotal that adds the lines up", async () => {
    renderCart();

    fireEvent.click(screen.getByText("add-a"));
    fireEvent.click(screen.getByText("add-a"));
    fireEvent.click(screen.getByText("add-a"));
    fireEvent.click(screen.getByText("add-b"));

    await screen.findByText("× 3");
    // 3 x $1,850.00 = $5,550.00 on the line, + $950.00 = $6,500.00.
    expect(screen.getByText("$5,550.00")).toBeInTheDocument();
    expect(screen.getByText("$6,500.00")).toBeInTheDocument();
  });

  it("caps the TOTAL quantity of a piece at its stock, across all its options", async () => {
    renderCart();

    // PENDANT has 2 in stock: one of each chain fills it.
    fireEvent.click(screen.getByText("add-pendant-45"));
    fireEvent.click(screen.getByText("add-pendant-50"));
    fireEvent.click(screen.getByText("add-pendant-45"));
    fireEvent.click(screen.getByText("add-pendant-50"));

    await screen.findByText("Cadena 50 cm");
    expect(storedCart().map((line) => line.quantity)).toEqual([1, 1]);
  });

  it("does not add a second unit of a one-of-one piece", async () => {
    renderCart();

    fireEvent.click(screen.getByText("add-b"));
    fireEvent.click(screen.getByText("add-b"));

    await screen.findByText(ITEM_B.title);
    expect(storedCart()).toEqual([{ ...ITEM_B, quantity: 1 }]);
  });

  it("takes the newest stock figure when a piece is added again", async () => {
    renderCart();

    fireEvent.click(screen.getByText("add-a"));
    fireEvent.click(screen.getByText("add-a-fewer"));

    await screen.findByText("× 2");
    expect(storedCart().map((line) => line.stock)).toEqual([2]);
  });
});

describe("CartDrawer — quantity controls", () => {
  const plusFor = (title: string) =>
    screen.getByRole("button", {
      name: esMessages.Cart.increase.replace("{title}", title),
    });
  const minusFor = (title: string) =>
    screen.getByRole("button", {
      name: esMessages.Cart.decrease.replace("{title}", title),
    });

  it("renders each line's quantity as a labelled group with accessible − and + buttons", async () => {
    renderCart();
    fireEvent.click(screen.getByText("add-a"));
    await screen.findByText("× 1");

    const group = screen.getByRole("group", {
      name: esMessages.Cart.quantityGroup.replace("{title}", ITEM_A.title),
    });
    expect(within(group).getAllByRole("button")).toHaveLength(2);
    expect(minusFor(ITEM_A.title)).toBeInTheDocument();
    expect(plusFor(ITEM_A.title)).toBeInTheDocument();
  });

  it("raises and lowers the quantity, updating the line total and the stored cart", async () => {
    renderCart();
    fireEvent.click(screen.getByText("add-a"));
    await screen.findByText("× 1");

    fireEvent.click(plusFor(ITEM_A.title));
    fireEvent.click(plusFor(ITEM_A.title));

    expect(screen.getByText("× 3")).toBeInTheDocument();
    expect(screen.getAllByText("$5,550.00")).toHaveLength(2); // line + subtotal
    expect(storedCart()[0].quantity).toBe(3);

    fireEvent.click(minusFor(ITEM_A.title));

    expect(screen.getByText("× 2")).toBeInTheDocument();
    expect(storedCart()[0].quantity).toBe(2);
  });

  it("disables − at 1: removing a line is the Eliminar button's job", async () => {
    renderCart();
    fireEvent.click(screen.getByText("add-a"));
    await screen.findByText("× 1");

    expect(minusFor(ITEM_A.title)).toBeDisabled();
  });

  it("disables + once the cart holds every piece the shop has, and says how many are left", async () => {
    renderCart();
    fireEvent.click(screen.getByText("add-pendant-45"));
    fireEvent.click(screen.getByText("add-pendant-45"));
    await screen.findByText("× 2");

    const plus = plusFor(`${PENDANT_45.title}, Cadena 45 cm`);
    expect(plus).toBeDisabled();
    expect(screen.getByText("Solo quedan 2")).toBeInTheDocument();

    fireEvent.click(plus);
    expect(storedCart()[0].quantity).toBe(2);
  });

  it("stops + at the stock shared with the piece's OTHER lines", async () => {
    renderCart();
    fireEvent.click(screen.getByText("add-pendant-45"));
    fireEvent.click(screen.getByText("add-pendant-50"));
    await screen.findByText("Cadena 50 cm");

    // 1 + 1 = the whole stock of 2: neither line can grow.
    expect(
      plusFor(`${PENDANT_45.title}, Cadena 45 cm`),
    ).toBeDisabled();
    expect(
      plusFor(`${PENDANT_50.title}, Cadena 50 cm`),
    ).toBeDisabled();
  });

  it("does not show the 'only N left' note for a one-of-one piece", async () => {
    renderCart();
    fireEvent.click(screen.getByText("add-b"));
    await screen.findByText(ITEM_B.title);

    expect(screen.getByRole("button", {
      name: esMessages.Cart.increase.replace("{title}", ITEM_B.title),
    })).toBeDisabled();
    expect(screen.queryByText(/^Solo quedan/)).not.toBeInTheDocument();
  });

  it("names each control with the option, so two sizes of one ring can be told apart", async () => {
    renderCart();
    fireEvent.click(screen.getByText("add-ring-7"));
    fireEvent.click(screen.getByText("add-ring-8"));
    await screen.findByText("Talla 8");

    expect(
      screen.getByRole("button", {
        name: esMessages.Cart.removeLabel.replace(
          "{title}",
          `${ITEM_A.title}, Talla 7`,
        ),
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: esMessages.Cart.removeLabel.replace(
          "{title}",
          `${ITEM_A.title}, Talla 8`,
        ),
      }),
    ).toBeInTheDocument();
  });

  it("removes only the line it belongs to when a piece is in the cart twice", async () => {
    renderCart();
    fireEvent.click(screen.getByText("add-ring-7"));
    fireEvent.click(screen.getByText("add-ring-8"));
    await screen.findByText("Talla 8");

    fireEvent.click(
      screen.getByRole("button", {
        name: esMessages.Cart.removeLabel.replace(
          "{title}",
          `${ITEM_A.title}, Talla 7`,
        ),
      }),
    );

    expect(screen.queryByText("Talla 7")).not.toBeInTheDocument();
    expect(screen.getByText("Talla 8")).toBeInTheDocument();
    expect(storedCart().map((line) => line.option)).toEqual([
      { kind: "ringSize", value: "8" },
    ]);
  });

  it("counts pieces, not lines, in the cart total sent to checkout", async () => {
    checkoutActionMock.mockResolvedValue({ ok: false, reason: "checkout-failed" });
    renderCart();
    fireEvent.click(screen.getByText("add-a"));
    fireEvent.click(screen.getByText("add-a"));
    await screen.findByText("× 2");

    fireEvent.click(
      screen.getByRole("button", { name: esMessages.Cart.checkout }),
    );

    await waitFor(() => expect(checkoutActionMock).toHaveBeenCalledTimes(1));
    expect(checkoutActionMock).toHaveBeenCalledWith(
      [{ ...ITEM_A, quantity: 2 }],
      "es",
    );
  });
});

describe("CartDrawer — cart-too-large result", () => {
  it("keeps the cart exactly as it is and says it is too large to pay in one go", async () => {
    checkoutActionMock.mockResolvedValue({ ok: false, reason: "cart-too-large" });
    renderCart();
    fireEvent.click(screen.getByText("add-a"));
    fireEvent.click(screen.getByText("add-a"));
    fireEvent.click(screen.getByText("add-b"));
    await screen.findByText("× 2");

    fireEvent.click(
      screen.getByRole("button", { name: esMessages.Cart.checkout }),
    );

    const notice = await screen.findByRole("alert");
    expect(notice).toHaveTextContent(esMessages.Cart.tooLargeNotice);
    expect(screen.getByText(ITEM_A.title)).toBeInTheDocument();
    expect(screen.getByText(ITEM_B.title)).toBeInTheDocument();
    expect(storedCart().map((line) => [line.handle, line.quantity])).toEqual([
      [ITEM_A.handle, 2],
      [ITEM_B.handle, 1],
    ]);
    // And the shopper can try again.
    expect(
      screen.getByRole("button", { name: esMessages.Cart.checkout }),
    ).toBeEnabled();
  });

  it("has the notice in both languages", () => {
    expect(esMessages.Cart.tooLargeNotice).toBeTruthy();
    expect(enMessages.Cart.tooLargeNotice).toBeTruthy();
  });
});

describe("CartDrawer — insufficient-stock result", () => {
  it("clamps the named piece to what is left, keeps the rest, and shows the localized notice", async () => {
    checkoutActionMock.mockResolvedValue({
      ok: false,
      reason: "insufficient-stock",
      items: [{ handle: ITEM_A.handle, available: 2 }],
    });
    renderCart();
    fireEvent.click(screen.getByText("add-a"));
    fireEvent.click(screen.getByText("add-a"));
    fireEvent.click(screen.getByText("add-a"));
    fireEvent.click(screen.getByText("add-b"));
    await screen.findByText("× 3");

    fireEvent.click(
      screen.getByRole("button", { name: esMessages.Cart.checkout }),
    );

    const notice = await screen.findByRole("alert");
    expect(notice).toHaveTextContent(esMessages.Cart.stockNotice);
    expect(screen.getByText("× 2")).toBeInTheDocument();
    expect(screen.getByText(ITEM_B.title)).toBeInTheDocument();
    expect(
      storedCart().map((line) => [line.handle, line.quantity, line.stock]),
    ).toEqual([
      [ITEM_A.handle, 2, 2],
      [ITEM_B.handle, 1, 1],
    ]);
  });

  it("trims a piece's lines in cart order, dropping the one that ends at zero", async () => {
    checkoutActionMock.mockResolvedValue({
      ok: false,
      reason: "insufficient-stock",
      items: [{ handle: ITEM_A.handle, available: 1 }],
    });
    renderCart();
    fireEvent.click(screen.getByText("add-ring-7"));
    fireEvent.click(screen.getByText("add-ring-8"));
    await screen.findByText("Talla 8");

    fireEvent.click(
      screen.getByRole("button", { name: esMessages.Cart.checkout }),
    );

    await screen.findByRole("alert");
    // The first line (size 7) keeps the one unit that is left; size 8 goes.
    expect(screen.getByText("Talla 7")).toBeInTheDocument();
    expect(screen.queryByText("Talla 8")).not.toBeInTheDocument();
  });

  it("shows the notice in the English locale too", () => {
    expect(enMessages.Cart.stockNotice).toBeTruthy();
    expect(enMessages.Cart.quantity).toBe("× {count}");
  });
});

describe("CartDrawer — option under the title", () => {
  it("shows the ring size", async () => {
    renderCart();
    fireEvent.click(screen.getByText("add-ring-7"));

    expect(await screen.findByText("Talla 7")).toBeInTheDocument();
  });

  it("shows the chain length", async () => {
    renderCart();
    fireEvent.click(screen.getByText("add-pendant-45"));

    expect(await screen.findByText("Cadena 45 cm")).toBeInTheDocument();
  });

  it("shows no option label for a piece without one", async () => {
    renderCart();
    fireEvent.click(screen.getByText("add-b"));

    await screen.findByText(ITEM_B.title);
    expect(screen.queryByText(/^Talla /)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Cadena /)).not.toBeInTheDocument();
  });

  it("renders no label, and does not crash, for a malformed option restored from storage", async () => {
    window.localStorage.setItem(
      CART_STORAGE_KEY,
      JSON.stringify([
        { ...ITEM_A, quantity: 1, option: { kind: "ringSize" } },
        { ...ITEM_B, quantity: 1, option: { kind: "weird", value: "x" } },
      ]),
    );

    renderCart();
    fireEvent.click(screen.getByText("open-drawer"));

    expect(await screen.findByText(ITEM_A.title)).toBeInTheDocument();
    expect(screen.getByText(ITEM_B.title)).toBeInTheDocument();
    expect(screen.queryByText(/undefined/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Talla /)).not.toBeInTheDocument();
  });

  it("sends the chosen option along with the cart lines at checkout", async () => {
    checkoutActionMock.mockResolvedValue({
      ok: false,
      reason: "checkout-failed",
    });
    renderCart();
    fireEvent.click(screen.getByText("add-ring-7"));
    await screen.findByText("Talla 7");

    fireEvent.click(
      screen.getByRole("button", { name: esMessages.Cart.checkout }),
    );

    await waitFor(() => expect(checkoutActionMock).toHaveBeenCalledTimes(1));
    expect(checkoutActionMock).toHaveBeenCalledWith(
      [{ ...RING_7, quantity: 1 }],
      "es",
    );
  });
});

describe("CartDrawer — invalid-option result", () => {
  it("drops the offending lines, keeps the rest, and asks to choose the option again", async () => {
    checkoutActionMock.mockResolvedValue({
      ok: false,
      reason: "invalid-option",
      handles: [ITEM_A.handle],
    });
    renderCart();
    fireEvent.click(screen.getByText("add-ring-7"));
    fireEvent.click(screen.getByText("add-b"));
    await screen.findByText("Talla 7");

    fireEvent.click(
      screen.getByRole("button", { name: esMessages.Cart.checkout }),
    );

    const notice = await screen.findByRole("alert");
    expect(notice).toHaveTextContent(esMessages.Cart.invalidOptionNotice);
    expect(screen.queryByText(ITEM_A.title)).not.toBeInTheDocument();
    expect(screen.queryByText("Talla 7")).not.toBeInTheDocument();
    expect(screen.getByText(ITEM_B.title)).toBeInTheDocument();
    expect(storedCart().map((line) => line.handle)).toEqual([ITEM_B.handle]);
  });

  it("still shows the notice when removing the offending line empties the cart", async () => {
    checkoutActionMock.mockResolvedValue({
      ok: false,
      reason: "invalid-option",
      handles: [ITEM_A.handle],
    });
    renderCart();
    fireEvent.click(screen.getByText("add-ring-7"));
    await screen.findByText("Talla 7");

    fireEvent.click(
      screen.getByRole("button", { name: esMessages.Cart.checkout }),
    );

    const notice = await screen.findByRole("alert");
    expect(notice).toHaveTextContent(esMessages.Cart.invalidOptionNotice);
    // The empty state and the explanation are shown together.
    expect(screen.getByText(esMessages.Cart.empty)).toBeInTheDocument();
    expect(storedCart()).toEqual([]);
  });

  it("handles the sold result the same way, notice included", async () => {
    checkoutActionMock.mockResolvedValue({
      ok: false,
      reason: "sold",
      soldHandles: [ITEM_B.handle],
    });
    renderCart();
    fireEvent.click(screen.getByText("add-b"));
    await screen.findByText(ITEM_B.title);

    fireEvent.click(
      screen.getByRole("button", { name: esMessages.Cart.checkout }),
    );

    const notice = await screen.findByRole("alert");
    expect(notice).toHaveTextContent(esMessages.Cart.soldNotice);
    expect(screen.queryByText(ITEM_B.title)).not.toBeInTheDocument();
  });

  it("keeps the cart and shows the retry message for a generic failure", async () => {
    checkoutActionMock.mockResolvedValue({
      ok: false,
      reason: "checkout-failed",
    });
    renderCart();
    fireEvent.click(screen.getByText("add-ring-7"));
    await screen.findByText("Talla 7");

    fireEvent.click(
      screen.getByRole("button", { name: esMessages.Cart.checkout }),
    );

    const notice = await screen.findByRole("alert");
    expect(notice).toHaveTextContent(esMessages.Cart.errorRetry);
    const list = screen.getByRole("list");
    expect(within(list).getByText(ITEM_A.title)).toBeInTheDocument();
  });
});
