"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { serializeOption } from "@/lib/commerce/options";
import type { MediaItem, Money, SelectedOption } from "@/lib/commerce/types";

// Client-only cart state. There is no server-side cart resource — Stripe
// Checkout Sessions are one-shot (unlike the dropped Shopify Cart API), so
// the cart's only persistence is localStorage (see design.md "Day 4 — Cart,
// Checkout Handoff"). A design can be made in several copies (its `stock`), so
// a line carries a `quantity`. A line is identified by its piece AND its
// option (the same ring in sizes 6 and 7 is two lines); adding the same piece
// with the same option again raises that line's quantity.
export interface CartLineItem {
  handle: string;
  /**
   * Display-only. `checkoutAction` (lib/cart/checkout.ts) never reads this —
   * the Stripe line item's name is re-fetched from the authoritative
   * catalog by `handle` instead, so a tampered value here can't reach
   * Stripe.
   */
  title: string;
  /**
   * Display-only (subtotal, per-line price shown in CartDrawer): the piece's
   * base price PLUS the chosen option's extra (e.g. a longer chain). NEVER the
   * source of a Stripe charge — `checkoutAction` re-fetches the real price
   * and the real extra from `commerce.getProductByHandle(handle, locale)` and
   * ignores this field entirely, since it's client-controlled (Server Action
   * argument / localStorage) and trivially tamperable.
   */
  price: Money;
  cover: MediaItem | null;
  /**
   * The shopper's ring size / chain length — absent for pieces that take no
   * option. Display-only here, like `price`/`title`, with one difference:
   * `checkoutAction` DOES read it, but only as a claim to validate. It is
   * checked against the catalog's resolved options for that handle, and a
   * missing, unknown or unexpected value is rejected (`invalid-option`), so a
   * tampered option can never reach Stripe either.
   */
  option?: SelectedOption;
  /** Units of this line: a positive whole number. */
  quantity: number;
  /**
   * How many pieces of this design the shop had when it was added (>= 1). The
   * client caps the TOTAL quantity of a handle at it — display-only, a
   * courtesy so the shopper is not offered what is not there. The server is the
   * authority: `checkoutAction` re-reads the live stock and answers
   * `insufficient-stock` when the cart asks for more.
   */
  stock: number;
}

// Versioned so a future CartLineItem shape change can be told apart from an
// old, incompatible stored payload instead of silently misreading it. v2 added
// `option`: a v1 cart can hold a ring with no size, which could never pass
// checkout. v3 made a handle appear on several lines and added `stock`: a v2
// cart has neither, so old payloads are ignored rather than migrated.
export const CART_STORAGE_KEY = "nerea:cart:v3";

const EMPTY_ITEMS: CartLineItem[] = [];

/**
 * What makes two lines the SAME line: the piece and the option chosen for it.
 * Built on `serializeOption` so it reads the same everywhere an option is
 * written down; a line without an option is keyed by its handle alone.
 */
export function cartLineKey(
  line: Pick<CartLineItem, "handle" | "option">,
): string {
  return line.option ? serializeOption(line.handle, line.option) : line.handle;
}

/** Pieces in the cart, all quantities added up (what the header shows). */
export function cartPieceCount(items: readonly CartLineItem[]): number {
  return items.reduce((sum, line) => sum + line.quantity, 0);
}

/** Units of one design in the cart, across all its lines (options). */
export function quantityOfHandle(
  items: readonly CartLineItem[],
  handle: string,
): number {
  return items.reduce(
    (sum, line) => (line.handle === handle ? sum + line.quantity : sum),
    0,
  );
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

// Stored lines come from localStorage — client-controlled, possibly corrupted
// or hand-edited — and every route renders from them (the cart count, the
// drawer). A single bad entry such as a stray `null` would throw while reading
// `line.handle` and break every page, so anything that does not have the shape
// the render path dereferences is dropped. `quantity` and `stock` are checked
// too, because the cart arithmetic (the total, the cap) runs on them; the rest
// of a line is display-only, and `checkoutAction` re-validates the option and
// the quantity and re-prices from the catalog regardless.
function isStoredLine(value: unknown): value is CartLineItem {
  if (typeof value !== "object" || value === null) return false;
  const { handle, title, price, quantity, stock } = value as Partial<
    Record<keyof CartLineItem, unknown>
  >;
  if (typeof handle !== "string" || handle === "") return false;
  if (typeof title !== "string") return false;
  if (typeof price !== "object" || price === null) return false;
  if (!isPositiveInteger(quantity) || !isPositiveInteger(stock)) return false;
  const { amount, currency } = price as { amount?: unknown; currency?: unknown };
  return Number.isFinite(amount) && typeof currency === "string";
}

function readStoredItems(): CartLineItem[] {
  if (typeof window === "undefined") return EMPTY_ITEMS;
  try {
    const raw = window.localStorage.getItem(CART_STORAGE_KEY);
    if (!raw) return EMPTY_ITEMS;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isStoredLine) : EMPTY_ITEMS;
  } catch {
    // Corrupted JSON or inaccessible storage (e.g. private-browsing quota) —
    // start from an empty cart instead of throwing.
    return EMPTY_ITEMS;
  }
}

function persistItems(items: CartLineItem[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Storage full/unavailable — the in-memory cart still works for this
    // session, it just won't survive a reload.
  }
}

// Pure transitions over a list of lines, kept apart from the store so the cart
// arithmetic reads (and tests) without React or storage in the way.

/** Raises the line of `item` by one, or adds it; never past the stock. */
export function addToCart(
  items: CartLineItem[],
  item: Omit<CartLineItem, "quantity">,
): CartLineItem[] {
  // The newest stock figure wins for EVERY line of the piece, so the cap below
  // and the drawer's "+" agree.
  const refreshed = items.map((line) =>
    line.handle === item.handle ? { ...line, stock: item.stock } : line,
  );
  if (quantityOfHandle(refreshed, item.handle) >= item.stock) {
    // Everything the shop has of this piece is already in the cart.
    return refreshed;
  }

  const key = cartLineKey(item);
  const exists = refreshed.some((line) => cartLineKey(line) === key);
  if (!exists) {
    return [...refreshed, { ...item, quantity: 1 }];
  }
  // Re-adding refreshes what is DISPLAYED too (title, price, cover): the price
  // includes the option's extra, so it can never disagree with the option it
  // sits next to. The line keeps its place.
  return refreshed.map((line) =>
    cartLineKey(line) === key
      ? { ...item, quantity: line.quantity + 1 }
      : line,
  );
}

/**
 * Sets a line's quantity, clamped to [1, the stock left for it once the other
 * lines of the same piece are counted]. A non-integer is ignored.
 */
export function setLineQuantity(
  items: CartLineItem[],
  key: string,
  quantity: number,
): CartLineItem[] {
  if (!Number.isInteger(quantity)) return items;
  const target = items.find((line) => cartLineKey(line) === key);
  if (!target) return items;

  const others = quantityOfHandle(items, target.handle) - target.quantity;
  const clamped = Math.max(1, Math.min(quantity, target.stock - others));
  if (clamped === target.quantity) return items;
  return items.map((line) =>
    line === target ? { ...line, quantity: clamped } : line,
  );
}

/**
 * Applies the server's `insufficient-stock` answer: the lines of each named
 * piece are trimmed (in cart order) until the piece fits `available`, a line
 * that ends at 0 is dropped, and the piece's `stock` is brought up to date.
 */
export function clampToStock(
  items: CartLineItem[],
  limits: ReadonlyArray<{ handle: string; available: number }>,
): CartLineItem[] {
  const available = new Map(
    limits.map((limit) => [limit.handle, Math.max(0, Math.floor(limit.available))]),
  );
  const left = new Map(available);
  return items.flatMap((line) => {
    const room = left.get(line.handle);
    if (room === undefined) return [line];
    const quantity = Math.min(line.quantity, room);
    left.set(line.handle, room - quantity);
    return quantity > 0
      ? [{ ...line, quantity, stock: available.get(line.handle) ?? line.stock }]
      : [];
  });
}

// One store instance per <CartProvider> mount (created lazily below via
// `useState(createCartStore)`), read through `useSyncExternalStore` — the
// same SSR-safe-hydration pattern MotionProvider.tsx uses for
// prefers-reduced-motion. `getServerSnapshot` always returns the stable
// empty array, matching what the server renders, so there is never a
// hydration mismatch; the real, persisted cart is read exactly once, lazily,
// the first time React calls `subscribe()` — which only happens client-side,
// after the initial commit (the same safe timing a mount-only effect would
// use, expressed as store synchronization instead of `setState` inside an
// effect body).
function createCartStore() {
  let items: CartLineItem[] = EMPTY_ITEMS;
  let hydrated = false;
  const listeners = new Set<() => void>();

  function setItems(next: CartLineItem[]): void {
    if (next === items) return;
    items = next;
    persistItems(next);
    for (const listener of listeners) listener();
  }

  return {
    subscribe(listener: () => void): () => void {
      if (!hydrated) {
        hydrated = true;
        items = readStoredItems();
        listener();
      }
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot(): CartLineItem[] {
      return items;
    },
    getServerSnapshot(): CartLineItem[] {
      return EMPTY_ITEMS;
    },
    addItem(item: Omit<CartLineItem, "quantity">): void {
      setItems(addToCart(items, item));
    },
    setQuantity(key: string, quantity: number): void {
      setItems(setLineQuantity(items, key, quantity));
    },
    removeItem(key: string): void {
      setItems(items.filter((line) => cartLineKey(line) !== key));
    },
    removeItems(handles: string[]): void {
      setItems(items.filter((line) => !handles.includes(line.handle)));
    },
    clampToStock(
      limits: ReadonlyArray<{ handle: string; available: number }>,
    ): void {
      setItems(clampToStock(items, limits));
    },
    clear(): void {
      setItems(EMPTY_ITEMS);
    },
  };
}

interface CartContextValue {
  items: CartLineItem[];
  isOpen: boolean;
  addItem: (item: Omit<CartLineItem, "quantity">) => void;
  /** Sets a line's quantity (see `cartLineKey`), clamped to the stock. */
  setQuantity: (key: string, quantity: number) => void;
  /** Removes one line (see `cartLineKey`). */
  removeItem: (key: string) => void;
  /** Removes every line of these pieces. */
  removeItems: (handles: string[]) => void;
  /** Trims the pieces the server said it cannot fill (`insufficient-stock`). */
  clampToStock: (
    limits: ReadonlyArray<{ handle: string; available: number }>,
  ) => void;
  clear: () => void;
  open: () => void;
  close: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createCartStore);
  const items = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );
  const [isOpen, setIsOpen] = useState(false);

  const addItem = useCallback(
    (item: Omit<CartLineItem, "quantity">) => {
      store.addItem(item);
      setIsOpen(true);
    },
    [store],
  );

  const setQuantity = useCallback(
    (key: string, quantity: number) => store.setQuantity(key, quantity),
    [store],
  );

  const removeItem = useCallback(
    (key: string) => store.removeItem(key),
    [store],
  );

  const removeItems = useCallback(
    (handles: string[]) => store.removeItems(handles),
    [store],
  );

  const clampStock = useCallback(
    (limits: ReadonlyArray<{ handle: string; available: number }>) =>
      store.clampToStock(limits),
    [store],
  );

  const clear = useCallback(() => store.clear(), [store]);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  const value = useMemo<CartContextValue>(
    () => ({
      items,
      isOpen,
      addItem,
      setQuantity,
      removeItem,
      removeItems,
      clampToStock: clampStock,
      clear,
      open,
      close,
    }),
    [
      items,
      isOpen,
      addItem,
      setQuantity,
      removeItem,
      removeItems,
      clampStock,
      clear,
      open,
      close,
    ],
  );

  return (
    <CartContext.Provider value={value}>{children}</CartContext.Provider>
  );
}

export function useCart(): CartContextValue {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error("useCart must be used within a CartProvider");
  }
  return context;
}
