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
  isVoidableSale,
  itemsSubtotal,
  resolveLivemode,
  summarizeSales,
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
import { SALE_FIGURE_FIELDS, readSaleFigures } from "./sale-figures";
import {
  COLLECTIONS,
  isDocumentId,
  isPieceHandle,
  readCentavos,
  readEnum,
  readOptionalCentavos,
  readOptionalString,
  readString,
  toDate,
} from "./shared";
import { fetchStripeFees } from "./stripe-fees";

// Sales: `sales/{id}` is one sale, manual (recorded here) or from Stripe
// (recorded by the webhook, see stripe-sales.ts). A sale is never deleted: a
// manual one, or a Stripe one made in TEST mode, is VOIDED, which keeps it on
// record and leaves it out of totals. A sale holds NO customer data (see
// sale-document.ts).
//
// Queries: the period filter is a range on `date` ordered by `date` — one
// field, served by the automatic single-field index. Filtering by status as
// well would need a composite index, so a voided sale is dropped in memory
// instead (see sumSales); the same goes for a test-mode sale. No composite
// index is needed anywhere in this file.

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
  /**
   * The terminal's commission on this sale, IVA included, integer centavos.
   * Absent or 0 for none (cash). It is a cost of the sale, so it can never be
   * more than what the customer paid.
   */
  terminalFee?: number;
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
  const terminalFee = input.terminalFee ?? 0;
  if (!isCentavos(terminalFee)) {
    throw new InventoryError("invalid-cost");
  }
  // A commission larger than what the customer paid is a typo, never a sale.
  if (terminalFee > itemsSubtotal(input.items) + input.shipping) {
    throw new SalesError("invalid-sale");
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
        terminalFee,
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
 * Voids a MANUAL sale, or a Stripe sale made in TEST mode (not a real payment,
 * so there is nothing to refund): it stays on record with `status: "void"` and
 * drops out of every total. A LIVE Stripe sale can't be voided (the payment
 * happened and is refunded in Stripe, not here). Whether a Stripe sale is test
 * or live is read like everywhere else (`resolveLivemode`): the stored
 * `livemode`, or for an older document its session id. Voiding an already
 * voided sale is a no-op that succeeds (`voided: false`), so a double click
 * can't fail or audit twice. Returns `null` when Firebase isn't configured.
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
    // Strict on purpose: a document whose source is unreadable is NOT assumed
    // manual (or test), and a live Stripe payment is never voidable here.
    const livemode = resolveLivemode(data.livemode, data.stripeSessionId);
    if (!isVoidableSale(data.source, livemode)) {
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

/**
 * "Actualizar comisión": reads Stripe's fee and net for a Stripe sale whose fee
 * could not be read when the webhook recorded it (`feePending`), and stores
 * them on the sale. Nothing else on the sale changes.
 *
 * Stripe is asked OUTSIDE the transaction (a network call has no place inside
 * one, which may be retried), and the sale is read again inside it, so two
 * clicks, or a click racing another, store the fee once and audit once. A sale
 * whose fee is already known succeeds as a no-op (`refreshed: false`).
 *
 * Rejects with a SalesError: "sale-not-found"; "fee-not-refreshable" for a sale
 * that has no Stripe fee to read (a manual one, or one with no session id);
 * "fee-unavailable" when Stripe can't give the fee yet (not settled, not
 * reachable, unknown to this account's keys). Returns `null` when Firebase
 * isn't configured.
 */
export async function refreshSaleFee(
  id: string,
  actor: string,
): Promise<{ refreshed: boolean } | null> {
  if (!isDocumentId(id)) {
    throw new SalesError("sale-not-found");
  }

  const db = getAdminDb();
  if (!db) {
    return null;
  }

  const ref = db.collection(COLLECTIONS.sales).doc(id);
  const snapshot = await ref.get();
  if (!snapshot.exists) {
    throw new SalesError("sale-not-found");
  }
  const current = snapshot.data() ?? {};
  const sessionId = readString(current.stripeSessionId);
  if (current.source !== "stripe" || sessionId === "") {
    throw new SalesError("fee-not-refreshable");
  }
  if (readOptionalCentavos(current.stripeFee) !== null) {
    return { refreshed: false };
  }

  const fees = await fetchStripeFees(sessionId);
  if (!fees) {
    throw new SalesError("fee-unavailable");
  }

  return db.runTransaction(async (tx) => {
    const latest = await tx.get(ref);
    if (!latest.exists) {
      throw new SalesError("sale-not-found");
    }
    if (readOptionalCentavos(latest.data()?.stripeFee) !== null) {
      return { refreshed: false };
    }

    tx.update(ref, {
      stripeFee: fees.fee,
      stripeNet: fees.net,
      feePending: false,
    });
    appendAuditEntry(db, tx, {
      actor,
      action: "sale.fee-refresh",
      entity: "sale",
      entityId: id,
    });

    return { refreshed: true };
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
  /**
   * `false` = made with Stripe's TEST keys: shown (badged, muted) but left out
   * of every total. A document from before the field existed is judged by its
   * session id (see `resolveLivemode`).
   */
  livemode: boolean;
  /**
   * The payment processor's commission on this sale, integer centavos: Stripe's
   * fee with the IVA on it, or the terminal's on a manual sale. 0 for none, and
   * while a Stripe fee is still pending.
   */
  fee: number;
  /** A Stripe sale whose fee has not been read from Stripe yet. */
  feePending: boolean;
  /** What Stripe deposits for the sale (charged minus fee), once known. */
  net: number | null;
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
  const source = readEnum(data.source, SALE_SOURCES, "manual");
  // What the totals read, from the same reader, so the list and the totals can
  // never disagree about a sale.
  const figures = readSaleFigures(data);

  return {
    id: doc.id,
    source,
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
    livemode: figures.livemode,
    fee: figures.fee,
    feePending: figures.feePending,
    net: source === "stripe" ? readOptionalCentavos(data.stripeNet) : null,
    note: readOptionalString(data.note),
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
 * computed here on the server: sales, cost of goods sold, gross profit and
 * commissions, with voided and Stripe test-mode sales left out. Reads only the
 * fields the totals need (SALE_FIGURE_FIELDS), and drops those sales in memory
 * — see the note at the top of this file. Returns `null` when Firebase isn't
 * configured.
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
    .select(...SALE_FIGURE_FIELDS)
    .limit(SALES_SUM_LIMIT + 1)
    .get();

  const counted = snapshot.docs.slice(0, SALES_SUM_LIMIT);
  return {
    ...summarizeSales(counted.map((doc) => readSaleFigures(doc.data() ?? {}))),
    truncated: snapshot.docs.length > SALES_SUM_LIMIT,
  };
}
