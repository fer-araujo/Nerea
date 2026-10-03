// The rules of the sales ledger, as pure functions (no I/O, safe in the
// browser bundle too). The Firestore layer (lib/admin/data/sales.ts and
// stripe-sales.ts) reads the state, calls these, and writes the result.
//
// Money is ALWAYS integer centavos.

export const SALE_SOURCES = ["stripe", "manual"] as const;
export type SaleSource = (typeof SALE_SOURCES)[number];

// A sale is never deleted: a mistake is corrected by voiding it, which keeps it
// on record but leaves it out of every total.
export const SALE_STATUSES = ["active", "void"] as const;
export type SaleStatus = (typeof SALE_STATUSES)[number];

/** One manual sale can span several pieces; this bounds the transaction. */
export const MAX_SALE_ITEMS = 25;

export type SalesErrorCode =
  | "piece-not-found"
  | "piece-unavailable"
  | "sale-not-found"
  | "sale-not-voidable"
  | "invalid-sale";

/**
 * A sales rule was broken. As with InventoryError the `code` is the contract:
 * server actions turn it into a typed result, so nothing about the underlying
 * failure (or any stored value) travels to the browser.
 */
export class SalesError extends Error {
  readonly code: SalesErrorCode;

  constructor(code: SalesErrorCode, message: string = code) {
    super(message);
    this.name = "SalesError";
    this.code = code;
  }
}

export interface SaleItem {
  handle: string;
  /** Piece title, copied from the catalog when the sale was recorded. */
  title: string;
  /** What this piece sold for, integer centavos. */
  price: number;
  /** "Talla 7", "Cadena 45 cm", or whatever the jeweler typed. */
  option?: string;
}

/** What the items add up to, integer centavos. */
export function itemsSubtotal(items: ReadonlyArray<{ price: number }>): number {
  return items.reduce((sum, item) => sum + item.price, 0);
}

export interface CostSnapshot {
  /** What the pieces that HAVE a cost recorded cost to make, centavos. */
  costOfGoods: number;
  /** True when at least one piece sold had no cost recorded at that moment. */
  costPending: boolean;
}

/**
 * The cost of a sale, frozen at the moment it is recorded. `costTotals` maps a
 * handle to its piece's total cost; a handle missing from it has no recorded
 * cost and marks the sale as pending (its cost counts as 0 until then, which
 * is why the gross profit of a pending sale is only an upper bound).
 */
export function costSnapshot(
  handles: readonly string[],
  costTotals: ReadonlyMap<string, number>,
): CostSnapshot {
  let costOfGoods = 0;
  let costPending = false;

  for (const handle of handles) {
    const cost = costTotals.get(handle);
    if (cost === undefined) {
      costPending = true;
    } else {
      costOfGoods += cost;
    }
  }
  return { costOfGoods, costPending };
}

/** The figures of one sale that a period total needs. */
export interface SaleFigures {
  status: SaleStatus;
  subtotal: number;
  shipping: number;
  total: number;
  costOfGoods: number;
  costPending: boolean;
}

export interface SalesTotals {
  /** Sales that count (not voided). */
  count: number;
  voidedCount: number;
  /**
   * What the pieces sold for ("ventas"), centavos. Shipping is NOT in it: the
   * flat fee is a pass-through whose real cost isn't tracked, so counting it
   * as revenue would inflate the gross profit.
   */
  subtotal: number;
  /** Shipping fees collected, shown beside the totals, never inside them. */
  shipping: number;
  /** Everything customers paid: subtotal + shipping. */
  total: number;
  costOfGoods: number;
  /** subtotal - costOfGoods. */
  grossProfit: number;
  /** Counted sales whose cost was still unknown when they were recorded. */
  pendingCount: number;
}

/**
 * Totals of a period, in one pass. A voided sale is left out of every figure
 * and only counted in `voidedCount`.
 */
export function summarizeSales(sales: Iterable<SaleFigures>): SalesTotals {
  const totals: SalesTotals = {
    count: 0,
    voidedCount: 0,
    subtotal: 0,
    shipping: 0,
    total: 0,
    costOfGoods: 0,
    grossProfit: 0,
    pendingCount: 0,
  };

  for (const sale of sales) {
    if (sale.status === "void") {
      totals.voidedCount += 1;
      continue;
    }
    totals.count += 1;
    totals.subtotal += sale.subtotal;
    totals.shipping += sale.shipping;
    totals.total += sale.total;
    totals.costOfGoods += sale.costOfGoods;
    if (sale.costPending) {
      totals.pendingCount += 1;
    }
  }

  totals.grossProfit = totals.subtotal - totals.costOfGoods;
  return totals;
}
