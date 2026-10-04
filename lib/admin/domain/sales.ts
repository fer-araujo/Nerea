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
  // "Actualizar comisión" on a sale that has no Stripe fee to read (a manual
  // one), and on a Stripe sale whose fee Stripe could not give yet.
  | "fee-not-refreshable"
  | "fee-unavailable"
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

// A Checkout Session id says which Stripe mode created it.
const TEST_SESSION_PREFIX = "cs_test_";
const LIVE_SESSION_PREFIX = "cs_live_";

/**
 * Whether a sale was made in Stripe's LIVE mode (`true`) or with its test keys
 * (`false`). Local testing writes to the same Firestore as production, so a
 * test purchase becomes a sale; this is how it is told apart from a real one.
 *
 * A stored `livemode` boolean wins (the webhook writes it from the verified
 * session). A document from before that field existed is judged by its
 * Checkout Session id (`cs_test_…` / `cs_live_…`). Anything else, such as a
 * manual sale or an unreadable id, counts as live: it is a real sale until
 * proven otherwise, so it is never silently dropped from the totals.
 */
export function resolveLivemode(
  stored: unknown,
  stripeSessionId: unknown,
): boolean {
  if (typeof stored === "boolean") {
    return stored;
  }
  if (typeof stripeSessionId === "string") {
    if (stripeSessionId.startsWith(TEST_SESSION_PREFIX)) {
      return false;
    }
    if (stripeSessionId.startsWith(LIVE_SESSION_PREFIX)) {
      return true;
    }
  }
  return true;
}

/**
 * Whether the panel may void a sale: a manual one, or a Stripe one made in TEST
 * mode (not a real payment, so there is nothing to refund). A LIVE Stripe
 * payment is refunded in Stripe, never voided here. `source` is `unknown` on
 * purpose, so a stored document whose source is unreadable is NOT assumed to be
 * either: it stays non-voidable.
 */
export function isVoidableSale(source: unknown, livemode: boolean): boolean {
  return source === "manual" || (source === "stripe" && !livemode);
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
  /**
   * `false` = a Stripe TEST-mode sale: not a real sale, left out of every total
   * (see `resolveLivemode`).
   */
  livemode: boolean;
  /**
   * The commission the payment processor charged on this sale, integer
   * centavos: Stripe's fee WITH the IVA on that fee (Stripe reports them
   * together), or the terminal's on a manual sale. 0 for none, and for a Stripe
   * sale whose fee is still unknown.
   */
  fee: number;
  /** A Stripe sale whose fee has not been read from Stripe yet. */
  feePending: boolean;
}

export interface SalesTotals {
  /** Sales that count (not voided, not made in test mode). */
  count: number;
  voidedCount: number;
  /** Test-mode Stripe sales left out of the totals (voided ones are in `voidedCount`). */
  testCount: number;
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
  /**
   * Commissions of the counted sales (Stripe's fee with its IVA, or the
   * terminal's). A sale with a pending fee adds 0 until it is refreshed.
   */
  fees: number;
  /** Counted Stripe sales whose fee was still unknown. */
  pendingFeeCount: number;
}

/**
 * Totals of a period, in one pass. A voided sale and a test-mode Stripe sale
 * are left out of every figure and only counted (in `voidedCount` /
 * `testCount`).
 */
export function summarizeSales(sales: Iterable<SaleFigures>): SalesTotals {
  const totals: SalesTotals = {
    count: 0,
    voidedCount: 0,
    testCount: 0,
    subtotal: 0,
    shipping: 0,
    total: 0,
    costOfGoods: 0,
    grossProfit: 0,
    pendingCount: 0,
    fees: 0,
    pendingFeeCount: 0,
  };

  for (const sale of sales) {
    if (sale.status === "void") {
      totals.voidedCount += 1;
      continue;
    }
    if (!sale.livemode) {
      totals.testCount += 1;
      continue;
    }
    totals.count += 1;
    totals.subtotal += sale.subtotal;
    totals.shipping += sale.shipping;
    totals.total += sale.total;
    totals.costOfGoods += sale.costOfGoods;
    totals.fees += sale.fee;
    if (sale.costPending) {
      totals.pendingCount += 1;
    }
    if (sale.feePending) {
      totals.pendingFeeCount += 1;
    }
  }

  totals.grossProfit = totals.subtotal - totals.costOfGoods;
  return totals;
}
