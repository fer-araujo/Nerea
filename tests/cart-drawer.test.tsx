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

const ITEM_A: Omit<CartLineItem, "quantity"> = {
  handle: "anillo-plata-cera-perdida",
  title: "Anillo de plata fundido a la cera perdida",
  price: { amount: 185000, currency: "MXN" },
  cover: null,
};

const ITEM_B: Omit<CartLineItem, "quantity"> = {
  handle: "aretes-plata-luna",
  title: 'Aretes de plata "fase lunar"',
  price: { amount: 95000, currency: "MXN" },
  cover: null,
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
  "add-b": ITEM_B,
  "add-ring-7": RING_7,
  "add-ring-8": RING_8,
  "add-pendant-45": PENDANT_45,
  "add-pendant-50": PENDANT_50,
};

function TestHarness() {
  const { addItem, open } = useCart();
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
      <CartDrawer />
    </>
  );
}

function renderCart() {
  return render(
    <NextIntlClientProvider locale="es" messages={esMessages}>
      <MotionProvider>
        <CartProvider>
          <TestHarness />
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

describe("cart v2 storage", () => {
  it("stores the cart under the v2 key", () => {
    expect(CART_STORAGE_KEY).toBe("nerea:cart:v2");
  });

  it("ignores a v1 cart, whose lines predate options and could not pass checkout", async () => {
    window.localStorage.setItem(
      "nerea:cart:v1",
      JSON.stringify([{ ...ITEM_A, quantity: 1 }]),
    );

    renderCart();
    fireEvent.click(screen.getByText("open-drawer"));

    expect(await screen.findByText(esMessages.Cart.empty)).toBeInTheDocument();
    expect(screen.queryByText(ITEM_A.title)).not.toBeInTheDocument();
  });

  it("persists the chosen option on the line", async () => {
    renderCart();
    fireEvent.click(screen.getByText("add-ring-7"));
    await screen.findByText(ITEM_A.title);

    expect(storedCart()).toEqual([
      { ...RING_7, quantity: 1 },
    ]);
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

  it("keeps a handle once and REPLACES its option when the piece is added again", async () => {
    renderCart();

    fireEvent.click(screen.getByText("add-pendant-45"));
    expect(await screen.findByText("Cadena 45 cm")).toBeInTheDocument();
    expect(screen.getAllByText("$4,200.00")).toHaveLength(2); // line + subtotal

    fireEvent.click(screen.getByText("add-pendant-50"));

    // Still a single line, now on the 50 cm chain at its higher price.
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText("Cadena 50 cm")).toBeInTheDocument();
    expect(screen.queryByText("Cadena 45 cm")).not.toBeInTheDocument();
    expect(screen.getAllByText("$4,350.00")).toHaveLength(2);
    expect(screen.queryByText("$4,200.00")).not.toBeInTheDocument();

    expect(storedCart()).toEqual([{ ...PENDANT_50, quantity: 1 }]);
  });

  it("keeps the line's position when its option is replaced", async () => {
    renderCart();

    fireEvent.click(screen.getByText("add-ring-7"));
    fireEvent.click(screen.getByText("add-b"));
    fireEvent.click(screen.getByText("add-ring-8"));

    await screen.findByText("Talla 8");
    expect(storedCart().map((line) => line.handle)).toEqual([
      ITEM_A.handle,
      ITEM_B.handle,
    ]);
    expect(storedCart()[0].option).toEqual({ kind: "ringSize", value: "8" });
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
