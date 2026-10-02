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
import type { MediaItem, Money, SelectedOption } from "@/lib/commerce/types";

// Client-only cart state. There is no server-side cart resource — Stripe
// Checkout Sessions are one-shot (unlike the dropped Shopify Cart API), so
// the cart's only persistence is localStorage (see design.md "Day 4 — Cart,
// Checkout Handoff"). Every nerea piece is one-of-one, so a line item never
// has a quantity selector: `quantity` is always 1 and a handle can only
// appear once (re-"adding" an already-in-cart handle REPLACES its line, so
// the shopper's latest option choice wins, and still re-opens the drawer).
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
  /**
   * Always 1 — one-of-one pieces never stack. Display-only, same as
   * `price`/`title` above: `checkoutAction` always charges quantity 1 per
   * handle regardless of this value.
   */
  quantity: number;
}

// Versioned so a future CartLineItem shape change can be told apart from an
// old, incompatible stored payload instead of silently misreading it. v2 added
// `option`: a v1 cart can hold a ring with no size, which could never pass
// checkout, so old payloads are ignored rather than migrated.
export const CART_STORAGE_KEY = "nerea:cart:v2";

const EMPTY_ITEMS: CartLineItem[] = [];

// Stored lines come from localStorage — client-controlled, possibly corrupted
// or hand-edited — and every route renders from them (the cart count, the
// drawer). A single bad entry such as a stray `null` would throw while reading
// `line.handle` and break every page, so anything that does not have the shape
// the render path dereferences is dropped. Only that shape is checked: the rest
// of a line is display-only, and `checkoutAction` re-validates the option and
// re-prices from the catalog regardless.
function isStoredLine(value: unknown): value is CartLineItem {
  if (typeof value !== "object" || value === null) return false;
  const { handle, title, price } = value as Partial<
    Record<keyof CartLineItem, unknown>
  >;
  if (typeof handle !== "string" || handle === "") return false;
  if (typeof title !== "string") return false;
  if (typeof price !== "object" || price === null) return false;
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
      const line: CartLineItem = { ...item, quantity: 1 };
      // One-of-one: a handle appears once. Re-adding replaces the whole line
      // in place (not just `option`) so the displayed price, which includes
      // the option's extra, can never disagree with the option it sits next to.
      const exists = items.some((current) => current.handle === item.handle);
      setItems(
        exists
          ? items.map((current) =>
              current.handle === item.handle ? line : current,
            )
          : [...items, line],
      );
    },
    removeItem(handle: string): void {
      setItems(items.filter((line) => line.handle !== handle));
    },
    removeItems(handles: string[]): void {
      setItems(items.filter((line) => !handles.includes(line.handle)));
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
  removeItem: (handle: string) => void;
  removeItems: (handles: string[]) => void;
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

  const removeItem = useCallback(
    (handle: string) => store.removeItem(handle),
    [store],
  );

  const removeItems = useCallback(
    (handles: string[]) => store.removeItems(handles),
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
      removeItem,
      removeItems,
      clear,
      open,
      close,
    }),
    [items, isOpen, addItem, removeItem, removeItems, clear, open, close],
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
