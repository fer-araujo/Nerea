// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import esMessages from "../messages/es.json";
import { MotionProvider } from "../components/motion/MotionProvider";
import {
  CART_STORAGE_KEY,
  CartProvider,
  useCart,
  type CartLineItem,
} from "../lib/cart/cart-context";
import { CartDrawer } from "../components/layout/CartDrawer";

// checkoutAction is out of scope for this file (covered by
// tests/cart-checkout-action.test.ts) — mocked as a no-op so CartDrawer can
// be exercised without next/headers or next/navigation request context.
vi.mock("../lib/cart/checkout", () => ({
  checkoutAction: vi.fn(),
}));

const ITEM_A: Omit<CartLineItem, "quantity"> = {
  handle: "anillo-plata-cera-perdida",
  title: "Anillo de plata fundido a la cera perdida",
  price: { amount: 185000, currency: "MXN" },
  image: "",
};

const ITEM_B: Omit<CartLineItem, "quantity"> = {
  handle: "aretes-plata-luna",
  title: 'Aretes de plata "fase lunar"',
  price: { amount: 95000, currency: "MXN" },
  image: "",
};

// Stand-in for AcquireButton/CartTrigger — exercises the same `useCart()`
// surface those real components call, scoped to what this file needs.
function TestHarness() {
  const { addItem, open } = useCart();
  return (
    <>
      <button type="button" onClick={() => addItem(ITEM_A)}>
        add-a
      </button>
      <button type="button" onClick={() => addItem(ITEM_B)}>
        add-b
      </button>
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

beforeEach(() => {
  window.localStorage.clear();
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
});
