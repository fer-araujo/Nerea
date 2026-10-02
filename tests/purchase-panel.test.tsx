// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import esMessages from "../messages/es.json";
import enMessages from "../messages/en.json";
import { PurchasePanel } from "../components/product/PurchasePanel";
import {
  CART_STORAGE_KEY,
  CartProvider,
  useCart,
  type CartLineItem,
} from "../lib/cart/cart-context";
import type { Product } from "../lib/commerce/types";

type PanelProduct = Pick<
  Product,
  "handle" | "title" | "price" | "cover" | "options"
>;

const RING: PanelProduct = {
  handle: "anillo-plata-cera-perdida",
  title: "Anillo de plata fundido a la cera perdida",
  price: { amount: 185000, currency: "MXN" },
  cover: null,
  options: { kind: "ringSize", values: ["6", "7", "7.5"] },
};

const PENDANT: PanelProduct = {
  handle: "dije-oro-amatista",
  title: "Dije de oro con amatista",
  price: { amount: 420000, currency: "MXN" },
  cover: null,
  options: {
    kind: "chainLength",
    values: [
      { lengthCm: 40, extra: 0 },
      { lengthCm: 45, extra: 0 },
      { lengthCm: 50, extra: 15000 },
    ],
  },
};

const PLAIN: PanelProduct = {
  handle: "aretes-plata-luna",
  title: 'Aretes de plata "fase lunar"',
  price: { amount: 95000, currency: "MXN" },
  cover: null,
  options: { kind: "none" },
};

// Reads back what the REAL CartProvider received, so these tests cover the
// whole path: pick -> enable -> add -> cart line.
function CartProbe() {
  const { items } = useCart();
  return <output data-testid="cart">{JSON.stringify(items)}</output>;
}

function renderPanel(
  product: PanelProduct,
  {
    locale,
    messages,
  }: {
    locale: "es" | "en";
    messages: typeof esMessages | typeof enMessages;
  } = { locale: "es", messages: esMessages },
) {
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <CartProvider>
        <PurchasePanel
          label={messages.ProductDetail.acquireCta}
          product={product}
        />
        <CartProbe />
      </CartProvider>
    </NextIntlClientProvider>,
  );
}

function cartItems(): CartLineItem[] {
  return JSON.parse(screen.getByTestId("cart").textContent ?? "[]");
}

const acquireButton = () =>
  screen.getByRole("button", { name: esMessages.ProductDetail.acquireCta });

beforeEach(() => {
  window.localStorage.clear();
});

describe("PurchasePanel — ring size", () => {
  it("renders an accessible radio group with one radio per size", () => {
    renderPanel(RING);

    const group = screen.getByRole("radiogroup", {
      name: esMessages.ProductDetail.ringSizeLegend,
    });
    expect(group).toHaveAttribute("aria-required", "true");
    const radios = screen.getAllByRole("radio");
    expect(radios.map((radio) => radio.closest("label")?.textContent)).toEqual([
      "6",
      "7",
      "7.5",
    ]);
    expect(radios.some((radio) => (radio as HTMLInputElement).checked)).toBe(
      false,
    );
  });

  it("keeps the acquire button disabled, with a hint tied to it, until a size is picked", () => {
    renderPanel(RING);

    const button = acquireButton();
    expect(button).toBeDisabled();

    const hint = screen.getByText(esMessages.ProductDetail.ringSizeHint);
    expect(button).toHaveAttribute("aria-describedby", hint.id);
    expect(hint.id).not.toBe("");
  });

  it("does not add anything when the disabled button is clicked", () => {
    renderPanel(RING);

    fireEvent.click(acquireButton());

    expect(cartItems()).toEqual([]);
  });

  it("enables the button, and drops the hint, once a size is picked", () => {
    renderPanel(RING);

    fireEvent.click(screen.getByRole("radio", { name: "7" }));

    expect(screen.getByRole("radio", { name: "7" })).toBeChecked();
    expect(acquireButton()).toBeEnabled();
    expect(acquireButton()).not.toHaveAttribute("aria-describedby");
    expect(
      screen.queryByText(esMessages.ProductDetail.ringSizeHint),
    ).not.toBeInTheDocument();
  });

  it("adds the piece to the cart with the chosen size and the base price", () => {
    renderPanel(RING);

    fireEvent.click(screen.getByRole("radio", { name: "7.5" }));
    fireEvent.click(acquireButton());

    expect(cartItems()).toEqual([
      {
        handle: RING.handle,
        title: RING.title,
        price: RING.price,
        cover: null,
        option: { kind: "ringSize", value: "7.5" },
        quantity: 1,
      },
    ]);
  });

  it("keeps a single selection and uses the latest one", () => {
    renderPanel(RING);

    fireEvent.click(screen.getByRole("radio", { name: "7" }));
    fireEvent.click(screen.getByRole("radio", { name: "6" }));

    expect(screen.getByRole("radio", { name: "6" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "7" })).not.toBeChecked();

    fireEvent.click(acquireButton());
    expect(cartItems()[0].option).toEqual({ kind: "ringSize", value: "6" });
  });

  it("gives every chip a 44px minimum target", () => {
    renderPanel(RING);

    for (const radio of screen.getAllByRole("radio")) {
      const chip = radio.nextElementSibling;
      expect(chip).toHaveClass("min-h-11", "min-w-11");
    }
  });
});

describe("PurchasePanel — chain length", () => {
  it("renders a labelled radio group and shows the extra only where there is one", () => {
    renderPanel(PENDANT);

    expect(
      screen.getByRole("radiogroup", {
        name: esMessages.ProductDetail.chainLengthLegend,
      }),
    ).toBeInTheDocument();

    const plain = screen.getByRole("radio", { name: "40 cm" }).closest("label");
    const extra = screen.getByRole("radio", { name: /^50 cm/ }).closest("label");
    expect(plain).not.toHaveTextContent("+");
    expect(extra).toHaveTextContent("50 cm");
    expect(extra).toHaveTextContent("+$150.00");
  });

  it("stays disabled with the chain hint until a length is picked", () => {
    renderPanel(PENDANT);

    expect(acquireButton()).toBeDisabled();
    expect(
      screen.getByText(esMessages.ProductDetail.chainLengthHint),
    ).toBeInTheDocument();
  });

  it("adds the base price for a length with no extra", () => {
    renderPanel(PENDANT);

    fireEvent.click(screen.getByRole("radio", { name: "45 cm" }));
    fireEvent.click(acquireButton());

    const [line] = cartItems();
    expect(line.option).toEqual({ kind: "chainLength", lengthCm: 45 });
    expect(line.price.amount).toBe(420000);
  });

  it("adds base + extra as the displayed price for a length with an extra", () => {
    renderPanel(PENDANT);

    fireEvent.click(screen.getByRole("radio", { name: /^50 cm/ }));
    fireEvent.click(acquireButton());

    const [line] = cartItems();
    expect(line.option).toEqual({ kind: "chainLength", lengthCm: 50 });
    expect(line.price).toEqual({ amount: 420000 + 15000, currency: "MXN" });
  });

  it("goes back to the base price if the shopper switches to a length with no extra", () => {
    renderPanel(PENDANT);

    fireEvent.click(screen.getByRole("radio", { name: /^50 cm/ }));
    fireEvent.click(screen.getByRole("radio", { name: "40 cm" }));
    fireEvent.click(acquireButton());

    expect(cartItems()[0].price.amount).toBe(420000);
  });
});

describe("PurchasePanel — piece without an option", () => {
  it("renders no picker and no hint, and the button is enabled straight away", () => {
    renderPanel(PLAIN);

    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(acquireButton()).toBeEnabled();
    expect(acquireButton()).not.toHaveAttribute("aria-describedby");
  });

  it("adds the piece with no option field", () => {
    renderPanel(PLAIN);

    fireEvent.click(acquireButton());

    const [line] = cartItems();
    expect(line.handle).toBe(PLAIN.handle);
    expect(line.price).toEqual(PLAIN.price);
    expect(line).not.toHaveProperty("option");
    expect(window.localStorage.getItem(CART_STORAGE_KEY)).not.toContain(
      "option",
    );
  });
});

describe("PurchasePanel — English", () => {
  it("localizes the legend, the chip label and the hint", () => {
    renderPanel(PENDANT, { locale: "en", messages: enMessages });

    expect(
      screen.getByRole("radiogroup", {
        name: enMessages.ProductDetail.chainLengthLegend,
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "40 cm" })).toBeInTheDocument();
    expect(
      screen.getByText(enMessages.ProductDetail.chainLengthHint),
    ).toBeInTheDocument();
    // `MX$` disambiguates the currency in English, per components/ui/Price.tsx.
    expect(
      screen.getByRole("radio", { name: /^50 cm/ }).closest("label"),
    ).toHaveTextContent("+MX$150.00");
  });
});
