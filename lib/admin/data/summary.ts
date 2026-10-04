import "server-only";
import { Timestamp, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/admin/firebase/admin";
import type { PeriodRange } from "@/lib/admin/domain/periods";
import type { SummaryPurchase, SummarySale } from "@/lib/admin/domain/summary";
import { readInBatches } from "./batched-read";
import { SALE_FIGURE_FIELDS, readSaleFigures } from "./sale-figures";
import { COLLECTIONS, readCentavos, toDate } from "./shared";

// What the Resumen page reads from the ledgers: the sales and the purchases
// inside ONE date window (see ledgerWindow in domain/summary.ts, which makes it
// serve both the KPI cards and the twelve-month chart).
//
// Queries: a range on `date` ordered by `date` — one field, served by the
// automatic single-field index. Filtering by status as well would need a
// composite index, so a voided sale is dropped in memory by the domain
// functions instead. No composite index is needed anywhere in this file.
//
// Bounded, never silently: each collection is read in cursor-paged batches up
// to a cap, newest first, and when the cap is hit `truncated` says so — the
// page then shows "Datos parciales" instead of presenting a partial total as
// the whole one. Newest first on purpose: if something has to be cut, it is
// the oldest months, not the period the cards are about.

/** Cap on sales read for one dashboard (a year holds a few hundred). */
export const SUMMARY_SALES_LIMIT = 2000;
/** Cap on purchases read for one dashboard (a year holds a few dozen). */
export const SUMMARY_PURCHASES_LIMIT = 2000;

// Only the fields the figures need (a sale's are the ones readSaleFigures
// reads: the totals, plus what tells a test-mode sale and a commission). `date`
// is both read and ordered by, which the batch cursor requires (see
// readInBatches).
const SALE_FIELDS = ["date", ...SALE_FIGURE_FIELDS] as const;
const PURCHASE_FIELDS = ["date", "totalCost"] as const;

export interface SummaryLedger {
  sales: SummarySale[];
  purchases: SummaryPurchase[];
  /** True when either list hit its cap: totals built from it are PARTIAL. */
  truncated: boolean;
}

// Documents are only written by this folder but can be edited by hand in the
// Firebase console, so every field is coerced instead of trusted.
function toSummarySale(doc: QueryDocumentSnapshot): SummarySale {
  const data = doc.data();
  return {
    date: toDate(data.date),
    // The Ventas totals read a sale with this same function, so the dashboard
    // and that page can never disagree about which sales count.
    ...readSaleFigures(data),
  };
}

function toSummaryPurchase(doc: QueryDocumentSnapshot): SummaryPurchase {
  const data = doc.data();
  return {
    date: toDate(data.date),
    totalCost: readCentavos(data.totalCost),
  };
}

/**
 * Every sale and purchase dated inside `window`, newest first, each list read
 * in parallel and capped (see the note at the top). Returns `null` when
 * Firebase isn't configured; a Firestore failure rejects.
 */
export async function readSummaryLedger(
  window: PeriodRange,
): Promise<SummaryLedger | null> {
  const db = getAdminDb();
  if (!db) {
    return null;
  }

  const start = Timestamp.fromDate(window.start);
  const end = Timestamp.fromDate(window.end);
  const inWindow = (collection: string) =>
    db
      .collection(collection)
      .where("date", ">=", start)
      .where("date", "<", end)
      .orderBy("date", "desc");

  const [sales, purchases] = await Promise.all([
    readInBatches(
      inWindow(COLLECTIONS.sales).select(...SALE_FIELDS),
      toSummarySale,
      { limit: SUMMARY_SALES_LIMIT },
    ),
    readInBatches(
      inWindow(COLLECTIONS.purchases).select(...PURCHASE_FIELDS),
      toSummaryPurchase,
      { limit: SUMMARY_PURCHASES_LIMIT },
    ),
  ]);

  return {
    sales: sales.rows,
    purchases: purchases.rows,
    truncated: sales.truncated || purchases.truncated,
  };
}
