import "server-only";
import { Timestamp, type DocumentSnapshot } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/admin/firebase/admin";
import { InventoryError } from "@/lib/admin/domain/inventory";
import { isCentavos } from "@/lib/admin/domain/money";
import type { PeriodRange } from "@/lib/admin/domain/periods";
import {
  MAX_SALE_ITEMS,
  SALE_SOURCES,
  SALE_STATUSES,
  SalesError,
  costSnapshot,
  itemsSubtotal,
  summarizeSales,
  type SaleFigures,
  type SaleItem,
  type SaleSource,
  type SaleStatus,
  type SalesTotals,
} from "@/lib/admin/domain/sales";
import { pageOffset } from "@/lib/admin/pagination";
import { appendAuditEntry } from "./audit-log";
import { getCatalogProducts } from "./catalog";
import { readPieceCostTotals } from "./pieces";
import { buildSaleDocument } from "./sale-document";
import {
  COLLECTIONS,
  isDocumentId,
  isPieceHandle,
  readCentavos,
  readEnum,
  readOptionalString,
  readString,
  toDate,
} from "./shared";

// Sales: `sales/{id}` is one sale, manual (recorded here) or from Stripe
// (recorded by the webhook, see stripe-sales.ts). A sale is never deleted: a
// manual one is VOIDED, which keeps it on record and leaves it out of totals.
// A sale holds NO customer data (see sale-document.ts).
//
// Queries: the period filter is a range on `date` ordered by `date` — one
// field, served by the automatic single-field index. Filtering by status as
// well would need a composite index, so a voided sale is dropped in memory
// instead (see sumSales). No composite index is needed anywhere in this file.

export const SALES_PAGE_SIZE = 20;
/** Cap on documents read to total a period (a year is a few hundred). */
export const SALES_SUM_LIMIT = 2000;

export interface ManualSaleItemInput {
  handle: string;
  /** What it sold for, integer centavos (may be below the catalog price). */
  price: number;
  /** Free text: "Talla 7", "Cadena 45 cm". */
  option?: string;
}

export interface RecordManualSaleInput {
  /** The business date: the instant that day begins in Mexico City. */
  date: Date;
  items: ManualSaleItemInput[];
  /** Shipping charged, integer centavos (0 for none). */
  shipping: number;
  note?: string;
}

/**
 * Records a sale made outside the online shop. The pieces must exist in the
 * catalog and still be available, and their TITLES come from the catalog,
 * never from the caller. The cost of the sale is frozen in the same
 * transaction that writes it (from `pieces/{handle}`; a piece with no cost
 * recorded makes the sale "costo pendiente"), and so is the audit entry.
 *
 * It does NOT mark anything sold in Sanity: that is a write to another system
 * with its own failure modes, so the caller decides (see the action). The
 * lines as recorded come back with the id, so the caller can name a piece by
 * its title if it later fails to mark it.
 *
 * Rejects with a SalesError ("invalid-sale", "piece-not-found",
 * "piece-unavailable") or an InventoryError "invalid-cost"; returns `null`
 * when Firebase isn't configured. A Sanity failure rejects as is.
 */
export async function recordManualSale(
  input: RecordManualSaleInput,
  actor: string,
): Promise<{ id: string; items: SaleItem[] } | null> {
  if (input.items.length < 1 || input.items.length > MAX_SALE_ITEMS) {
    throw new SalesError("invalid-sale");
  }
  const handles = input.items.map((item) => item.handle);
  // One-of-one pieces: a piece appears at most once in a sale.
  if (new Set(handles).size !== handles.length) {
    throw new SalesError("invalid-sale");
  }
  for (const item of input.items) {
    if (!isPieceHandle(item.handle)) {
      throw new SalesError("piece-not-found");
    }
    if (!isCentavos(item.price)) {
      throw new InventoryError("invalid-cost");
    }
  }
  if (!isCentavos(input.shipping)) {
    throw new InventoryError("invalid-cost");
  }

  // Checked before the network call: with Firebase down there is nothing to do.
  const db = getAdminDb();
  if (!db) {
    return null;
  }

  const catalog = await getCatalogProducts(handles);
  const items: SaleItem[] = input.items.map((item) => {
    const product = catalog.get(item.handle);
    if (!product) {
      throw new SalesError("piece-not-found");
    }
    if (product.availability !== "available") {
      throw new SalesError("piece-unavailable");
    }
    return {
      handle: item.handle,
      title: product.title || item.handle,
      price: item.price,
      ...(item.option ? { option: item.option } : {}),
    };
  });
  const subtotal = itemsSubtotal(items);

  return db.runTransaction(async (tx) => {
    // Transactions need every read before the first write.
    const { costOfGoods, costPending } = costSnapshot(
      handles,
      await readPieceCostTotals(db, tx, handles),
    );

    const saleRef = db.collection(COLLECTIONS.sales).doc();
    tx.create(
      saleRef,
      buildSaleDocument({
        source: "manual",
        date: input.date,
        items,
        subtotal,
        shipping: input.shipping,
        total: subtotal + input.shipping,
        costOfGoods,
        costPending,
        ...(input.note ? { note: input.note } : {}),
        actor,
      }),
    );
    appendAuditEntry(db, tx, {
      actor,
      action: "sale.record",
      entity: "sale",
      entityId: saleRef.id,
    });

    return { id: saleRef.id, items };
  });
}

/**
 * Voids a MANUAL sale: it stays on record with `status: "void"` and drops out
 * of every total. A Stripe sale can't be voided (the payment happened and is
 * refunded in Stripe, not here). Voiding an already voided sale is a no-op that
 * succeeds (`voided: false`), so a double click can't fail or audit twice.
 * Returns `null` when Firebase isn't configured.
 */
export async function voidSale(
  id: string,
  actor: string,
): Promise<{ voided: boolean } | null> {
  if (!isDocumentId(id)) {
    throw new SalesError("sale-not-found");
  }

  const db = getAdminDb();
  if (!db) {
    return null;
  }

  return db.runTransaction(async (tx) => {
    const ref = db.collection(COLLECTIONS.sales).doc(id);
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) {
      throw new SalesError("sale-not-found");
    }

    const data = snapshot.data() ?? {};
    // Strict on purpose: a document whose source is unreadable is NOT
    // assumed manual.
    if (data.source !== "manual") {
      throw new SalesError("sale-not-voidable");
    }
    if (data.status === "void") {
      return { voided: false };
    }

    tx.update(ref, { status: "void" });
    appendAuditEntry(db, tx, {
      actor,
      action: "sale.void",
      entity: "sale",
      entityId: id,
    });

    return { voided: true };
  });
}

export interface Sale {
  id: string;
  source: SaleSource;
  status: SaleStatus;
  date: Date | null;
  items: SaleItem[];
  subtotal: number;
  shipping: number;
  total: number;
  costOfGoods: number;
  costPending: boolean;
  note: string | null;
}

export interface SalePage {
  sales: Sale[];
  hasNextPage: boolean;
}

export interface SalesPeriodTotal extends SalesTotals {
  /** True when the period holds more than SALES_SUM_LIMIT sales. */
  truncated: boolean;
}

function toSaleItem(raw: unknown): SaleItem | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const item = raw as Record<string, unknown>;
  const option = readOptionalString(item.option);
  return {
    handle: readString(item.handle),
    title: readString(item.title),
    price: readCentavos(item.price),
    ...(option ? { option } : {}),
  };
}

// Documents are only written by this folder but can be edited by hand in the
// Firebase console, so every field is coerced instead of trusted.
function toSale(doc: DocumentSnapshot): Sale {
  const data = doc.data() ?? {};
  const rawItems: unknown[] = Array.isArray(data.items) ? data.items : [];

  return {
    id: doc.id,
    source: readEnum(data.source, SALE_SOURCES, "manual"),
    status: readEnum(data.status, SALE_STATUSES, "active"),
    date: toDate(data.date),
    items: rawItems.flatMap((raw) => {
      const item = toSaleItem(raw);
      return item ? [item] : [];
    }),
    subtotal: readCentavos(data.subtotal),
    shipping: readCentavos(data.shipping),
    total: readCentavos(data.total),
    costOfGoods: readCentavos(data.costOfGoods),
    costPending: data.costPending === true,
    note: readOptionalString(data.note),
  };
}

function toFigures(doc: DocumentSnapshot): SaleFigures {
  const data = doc.data() ?? {};
  return {
    status: readEnum(data.status, SALE_STATUSES, "active"),
    subtotal: readCentavos(data.subtotal),
    shipping: readCentavos(data.shipping),
    total: readCentavos(data.total),
    costOfGoods: readCentavos(data.costOfGoods),
    costPending: data.costPending === true,
  };
}

/**
 * One page of the sales inside `range`, newest sale date first (1-based
 * `page`), voided ones included (the page shows them muted). Fetches one extra
 * document to learn whether a next page exists. Returns `null` when Firebase
 * isn't configured.
 */
export async function listSales(
  range: PeriodRange,
  page = 1,
): Promise<SalePage | null> {
  const db = getAdminDb();
  if (!db) {
    return null;
  }

  const snapshot = await db
    .collection(COLLECTIONS.sales)
    .where("date", ">=", Timestamp.fromDate(range.start))
    .where("date", "<", Timestamp.fromDate(range.end))
    .orderBy("date", "desc")
    .offset(pageOffset(page, SALES_PAGE_SIZE))
    .limit(SALES_PAGE_SIZE + 1)
    .get();

  return {
    sales: snapshot.docs.slice(0, SALES_PAGE_SIZE).map(toSale),
    hasNextPage: snapshot.docs.length > SALES_PAGE_SIZE,
  };
}

/**
 * The totals of `range` over ALL of its sales (not just the visible page),
 * computed here on the server: sales, cost of goods sold and gross profit,
 * with voided sales left out. Reads only the fields the totals need, and
 * drops the voided ones in memory — see the note at the top of this file.
 * Returns `null` when Firebase isn't configured.
 */
export async function sumSales(
  range: PeriodRange,
): Promise<SalesPeriodTotal | null> {
  const db = getAdminDb();
  if (!db) {
    return null;
  }

  const snapshot = await db
    .collection(COLLECTIONS.sales)
    .where("date", ">=", Timestamp.fromDate(range.start))
    .where("date", "<", Timestamp.fromDate(range.end))
    .select(
      "status",
      "subtotal",
      "shipping",
      "total",
      "costOfGoods",
      "costPending",
    )
    .limit(SALES_SUM_LIMIT + 1)
    .get();

  const counted = snapshot.docs.slice(0, SALES_SUM_LIMIT);
  return {
    ...summarizeSales(counted.map(toFigures)),
    truncated: snapshot.docs.length > SALES_SUM_LIMIT,
  };
}
