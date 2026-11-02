import { describe, expect, it } from "vitest";
import {
  addToCart,
  cartLineKey,
  cartPieceCount,
  clampToStock,
  quantityOfHandle,
  setLineQuantity,
  type CartLineItem,
} from "@/lib/cart/cart-context";

// The cart arithmetic, without React or storage in the way. How the drawer
// renders it and persists it is in tests/cart-drawer.test.tsx.
type NewLine = Omit<CartLineItem, "quantity">;

const RING: NewLine = {
  handle: "anillo",
  title: "Anillo",
  price: { amount: 185_000, currency: "MXN" },
  cover: null,
  stock: 4,
};
const RING_6: NewLine = { ...RING, option: { kind: "ringSize", value: "6" } };
const RING_7: NewLine = { ...RING, option: { kind: "ringSize", value: "7" } };
const CHAIN_45: NewLine = {
  handle: "dije",
  title: "Dije",
  price: { amount: 420_000, currency: "MXN" },
  cover: null,
  stock: 3,
  option: { kind: "chainLength", lengthCm: 45 },
};
const EARRINGS: NewLine = {
  handle: "aretes",
  title: "Aretes",
  price: { amount: 95_000, currency: "MXN" },
  cover: null,
  stock: 1,
};

function line(item: NewLine, quantity = 1): CartLineItem {
  return { ...item, quantity };
}

describe("cartLineKey", () => {
  it("is the handle alone for a line without an option", () => {
    expect(cartLineKey({ handle: "aretes" })).toBe("aretes");
  });

  it("includes the option, so the same piece in two sizes is two lines", () => {
    expect(cartLineKey(RING_6)).not.toBe(cartLineKey(RING_7));
    expect(cartLineKey(RING_6)).not.toBe(cartLineKey(RING));
  });

  it("is the same for the same handle and option, whatever else the line carries", () => {
    const renamed: NewLine = {
      ...RING_6,
      title: "Otro título",
      price: { amount: 1, currency: "MXN" },
    };

    expect(cartLineKey(renamed)).toBe(cartLineKey(RING_6));
  });

  it("tells a chain length apart from a ring size with the same number", () => {
    const size = cartLineKey({
      handle: "x",
      option: { kind: "ringSize", value: "45" },
    });
    const chain = cartLineKey({
      handle: "x",
      option: { kind: "chainLength", lengthCm: 45 },
    });

    expect(size).not.toBe(chain);
  });
});

describe("addToCart", () => {
  it("adds a new line with quantity 1", () => {
    expect(addToCart([], RING_6)).toEqual([line(RING_6, 1)]);
  });

  it("raises the quantity of the SAME handle + option", () => {
    const once = addToCart([], RING_6);
    const twice = addToCart(once, RING_6);

    expect(twice).toEqual([line(RING_6, 2)]);
  });

  it("starts a NEW line for a different option of the same piece, in order", () => {
    const next = addToCart(addToCart([], RING_6), RING_7);

    expect(next.map((entry) => [entry.option, entry.quantity])).toEqual([
      [{ kind: "ringSize", value: "6" }, 1],
      [{ kind: "ringSize", value: "7" }, 1],
    ]);
  });

  it("keeps a line's position when it is raised", () => {
    const items = [line(RING_6), line(EARRINGS), line(CHAIN_45)];

    const next = addToCart(items, RING_6);

    expect(next.map((entry) => entry.handle)).toEqual(["anillo", "aretes", "dije"]);
    expect(next[0].quantity).toBe(2);
  });

  it("caps the TOTAL quantity of a handle at the stock, across its options", () => {
    let items: CartLineItem[] = [];
    for (let times = 0; times < 4; times += 1) {
      items = addToCart(items, times % 2 === 0 ? RING_6 : RING_7);
    }
    expect(quantityOfHandle(items, "anillo")).toBe(4);

    const capped = addToCart(addToCart(items, RING_6), RING_7);

    expect(quantityOfHandle(capped, "anillo")).toBe(4);
    expect(capped.map((entry) => entry.quantity)).toEqual([2, 2]);
  });

  it("does not add a second unit of a one-of-one piece", () => {
    const once = addToCart([], EARRINGS);
    const again = addToCart(once, EARRINGS);

    expect(again).toEqual([line(EARRINGS, 1)]);
  });

  it("does not count other pieces against a piece's stock", () => {
    const items = addToCart(addToCart([], RING_6), CHAIN_45);

    expect(quantityOfHandle(items, "anillo")).toBe(1);
    expect(quantityOfHandle(items, "dije")).toBe(1);
  });

  it("takes the newest stock figure for EVERY line of the piece", () => {
    const items = addToCart(addToCart([], RING_6), RING_7);

    const next = addToCart(items, { ...RING_6, stock: 2 });

    // 2 already in the cart and the new stock is 2: nothing more is added, and
    // both lines now know the figure.
    expect(next.map((entry) => [entry.quantity, entry.stock])).toEqual([
      [1, 2],
      [1, 2],
    ]);
  });

  it("refreshes what a raised line DISPLAYS (title, price) from the newest add", () => {
    const items = addToCart([], RING_6);

    const next = addToCart(items, {
      ...RING_6,
      title: "Anillo renombrado",
      price: { amount: 190_000, currency: "MXN" },
    });

    expect(next[0]).toMatchObject({
      title: "Anillo renombrado",
      price: { amount: 190_000, currency: "MXN" },
      quantity: 2,
    });
  });

  it("does not mutate the list it was given", () => {
    const items = [line(RING_6)];
    const snapshot = JSON.stringify(items);

    addToCart(items, RING_6);
    addToCart(items, RING_7);

    expect(JSON.stringify(items)).toBe(snapshot);
  });

  it("adds nothing for a stock of zero", () => {
    expect(addToCart([], { ...RING, stock: 0 })).toEqual([]);
  });
});

describe("setLineQuantity", () => {
  const items = [line(RING_6, 1), line(RING_7, 1), line(EARRINGS, 1)];

  it("sets a line's quantity", () => {
    const next = setLineQuantity(items, cartLineKey(RING_6), 3);

    expect(next.map((entry) => entry.quantity)).toEqual([3, 1, 1]);
  });

  it("clamps to the stock left once the piece's OTHER lines are counted", () => {
    // 4 in stock, 1 already on the size-7 line: the size-6 line can reach 3.
    const next = setLineQuantity(items, cartLineKey(RING_6), 99);

    expect(next.map((entry) => entry.quantity)).toEqual([3, 1, 1]);
  });

  it("never goes below 1: removing a line is a different action", () => {
    const next = setLineQuantity([line(RING_6, 2)], cartLineKey(RING_6), 0);

    expect(next[0].quantity).toBe(1);
    expect(
      setLineQuantity([line(RING_6, 2)], cartLineKey(RING_6), -5)[0].quantity,
    ).toBe(1);
  });

  it.each([1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "ignores a quantity of %j",
    (quantity) => {
      expect(setLineQuantity(items, cartLineKey(RING_6), quantity)).toBe(items);
    },
  );

  it("ignores a line that is not in the cart", () => {
    expect(setLineQuantity(items, "fantasma", 3)).toBe(items);
  });

  it("returns the same list when nothing changes", () => {
    expect(setLineQuantity(items, cartLineKey(RING_6), 1)).toBe(items);
  });
});

describe("clampToStock", () => {
  it("trims the named piece to what is left, in cart order, dropping a line that ends at zero", () => {
    const items = [line(RING_6, 2), line(EARRINGS, 1), line(RING_7, 2)];

    const next = clampToStock(items, [{ handle: "anillo", available: 3 }]);

    expect(next.map((entry) => [entry.handle, entry.quantity])).toEqual([
      ["anillo", 2],
      ["aretes", 1],
      ["anillo", 1],
    ]);
    expect(
      next
        .filter((entry) => entry.handle === "anillo")
        .every((entry) => entry.stock === 3),
    ).toBe(true);
  });

  it("drops the later lines of a piece once the stock is used up", () => {
    const items = [line(RING_6, 2), line(RING_7, 2)];

    const next = clampToStock(items, [{ handle: "anillo", available: 2 }]);

    expect(next.map((entry) => entry.option)).toEqual([
      { kind: "ringSize", value: "6" },
    ]);
  });

  it("leaves the pieces it was not told about exactly as they are", () => {
    const items = [line(RING_6, 2), line(EARRINGS, 1)];

    const next = clampToStock(items, [{ handle: "anillo", available: 1 }]);

    expect(next[1]).toBe(items[1]);
  });

  it("removes a piece that has nothing available", () => {
    const next = clampToStock(
      [line(RING_6, 2)],
      [{ handle: "anillo", available: 0 }],
    );

    expect(next).toEqual([]);
  });

  it("handles several pieces at once", () => {
    const items = [line(RING_6, 3), line(CHAIN_45, 3)];

    const next = clampToStock(items, [
      { handle: "anillo", available: 2 },
      { handle: "dije", available: 1 },
    ]);

    expect(
      next.map((entry) => [entry.handle, entry.quantity, entry.stock]),
    ).toEqual([
      ["anillo", 2, 2],
      ["dije", 1, 1],
    ]);
  });

  it("does not mutate the list it was given", () => {
    const items = [line(RING_6, 3)];
    const snapshot = JSON.stringify(items);

    clampToStock(items, [{ handle: "anillo", available: 1 }]);

    expect(JSON.stringify(items)).toBe(snapshot);
  });
});

describe("cartPieceCount", () => {
  it("counts pieces, not lines", () => {
    expect(
      cartPieceCount([line(RING_6, 2), line(RING_7, 1), line(EARRINGS, 1)]),
    ).toBe(4);
    expect(cartPieceCount([])).toBe(0);
  });
});
