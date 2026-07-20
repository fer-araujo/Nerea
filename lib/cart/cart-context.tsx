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
import type { MediaItem, Money } from "@/lib/commerce/types";

// Client-only cart state. There is no server-side cart resource — Stripe
// Checkout Sessions are one-shot (unlike the dropped Shopify Cart API), so
// the cart's only persistence is localStorage (see design.md "Day 4 — Cart,
// Checkout Handoff"). Every nerea piece is one-of-one, so a line item never
// has a quantity selector: `quantity` is always 1 and a handle can only
// appear once (re-"adding" an already-in-cart handle is a no-op besides
// re-opening the drawer).
export interface CartLineItem {
  handle: string;
  title: string;
  price: Money;
  cover: MediaItem | null;
  /** Always 1 — one-of-one pieces never stack. */
  quantity: number;
}

// Versioned so a future CartLineItem shape change can be told apart from an
// old, incompatible stored payload instead of silently misreading it.
export const CART_STORAGE_KEY = "nerea:cart:v1";

const EMPTY_ITEMS: CartLineItem[] = [];

function readStoredItems(): CartLineItem[] {
  if (typeof window === "undefined") return EMPTY_ITEMS;
  try {
    const raw = window.localStorage.getItem(CART_STORAGE_KEY);
    if (!raw) return EMPTY_ITEMS;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CartLineItem[]) : EMPTY_ITEMS;
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
      if (items.some((line) => line.handle === item.handle)) return;
      setItems([...items, { ...item, quantity: 1 }]);
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
