import "server-only";
import {
  FieldValue,
  Timestamp,
  type DocumentSnapshot,
} from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/admin/firebase/admin";
import {
  InventoryError,
  MAX_PURCHASE_ITEMS,
  receiveStock,
} from "@/lib/admin/domain/inventory";
import { isCentavos, unitCostFromTotal } from "@/lib/admin/domain/money";
import type { PeriodRange } from "@/lib/admin/domain/periods";
import { pageOffset } from "@/lib/admin/pagination";
import { appendAuditEntry } from "./audit-log";
import {
  appendMovement,
  materialRef,
  toMaterial,
  type Material,
} from "./materials";
import {
  COLLECTIONS,
  isDocumentId,
  readCentavos,
  readNumber,
  readOptionalString,
  readString,
  toDate,
} from "./shared";

// Investments: every purchase of materials. `purchases/{id}` is the receipt;
// recording one ALSO raises each material's stock, re-averages its cost and
// appends a movement, all in one transaction (see materials.ts for the rules).
//
// Queries: the period filter is a range on `date` ordered by `date` — one
// field, served by the automatic single-field index, so no composite index
// is needed anywhere in this file.

export const PURCHASES_PAGE_SIZE = 20;
/** Cap on documents read to total a period (a year is a few dozen). */
export const PURCHASE_SUM_LIMIT = 2000;

export interface PurchaseItemInput {
  materialId: string;
  qty: number;
  /** What this line cost in total, integer centavos. */
  totalCost: number;
}

export interface RecordPurchaseInput {
  /** The business date: the instant that day begins in Mexico City. */
  date: Date;
  /** Who it was bought from, or a concept like "Inventario inicial". */
  supplier?: string;
  note?: string;
  items: PurchaseItemInput[];
}

export interface PurchaseItem {
  materialId: string;
  materialName: string;
  qty: number;
  totalCost: number;
}

export interface Purchase {
  id: string;
  date: Date | null;
  supplier: string | null;
  note: string | null;
  items: PurchaseItem[];
  totalCost: number;
}

export interface PurchasePage {
  purchases: Purchase[];
  hasNextPage: boolean;
}

export interface PurchaseTotal {
  /** Sum of `totalCost` over the period, integer centavos. */
  totalCost: number;
  count: number;
  /** True when the period holds more than PURCHASE_SUM_LIMIT purchases. */
  truncated: boolean;
}

/**
 * Records a purchase of one or more materials. For every line, in order:
 * the material's average cost is recomputed as a weighted average, its stock
 * goes up, and a "purchase" movement is appended; then the purchase document
 * itself is written. All or nothing: if any line is refused (unknown
 * material, a quantity that doesn't fit the unit) nothing is written.
 *
 * Material names are copied onto the receipt from the database, never taken
 * from the caller. Two lines for the same material are fine — each is applied
 * to the running state, so they average exactly as two separate purchases
 * would. Returns `null` when Firebase isn't configured.
 */
export async function recordPurchase(
  input: RecordPurchaseInput,
  actor: string,
): Promise<{ id: string } | null> {
  if (input.items.length < 1 || input.items.length > MAX_PURCHASE_ITEMS) {
    throw new InventoryError("invalid-quantity");
  }
  for (const item of input.items) {
    if (!isDocumentId(item.materialId)) {
      throw new InventoryError("material-not-found");
    }
    if (!isCentavos(item.totalCost)) {
      throw new InventoryError("invalid-cost");
    }
  }

  const db = getAdminDb();
  if (!db) {
    return null;
  }

  return db.runTransaction(async (tx) => {
    // Transactions need every read before the first write.
    const ids = [...new Set(input.items.map((item) => item.materialId))];
    const refs = ids.map((id) => materialRef(db, id));
    const snapshots = await tx.getAll(...refs);

    // Running state per material, so repeated lines compound correctly.
    const state = new Map<string, { material: Material; stock: number; avgCost: number }>();
    for (const snapshot of snapshots) {
      if (!snapshot.exists) {
        throw new InventoryError("material-not-found");
      }
      const material = toMaterial(snapshot);
      state.set(material.id, {
        material,
        stock: material.stock,
        avgCost: material.avgCost,
      });
    }

    const purchaseRef = db.collection(COLLECTIONS.purchases).doc();
    const items: PurchaseItem[] = [];
    let totalCost = 0;

    for (const item of input.items) {
      const running = state.get(item.materialId);
      if (!running) {
        throw new InventoryError("material-not-found");
      }

      const next = receiveStock(
        { stock: running.stock, avgCost: running.avgCost },
        running.material.unit,
        item.qty,
        item.totalCost,
      );
      running.stock = next.stock;
      running.avgCost = next.avgCost;

      items.push({
        materialId: item.materialId,
        materialName: running.material.name,
        qty: item.qty,
        totalCost: item.totalCost,
      });
      totalCost += item.totalCost;

      appendMovement(tx, materialRef(db, item.materialId), {
        type: "purchase",
        qty: item.qty,
        unitCost: unitCostFromTotal(item.totalCost, item.qty),
        totalCost: item.totalCost,
        refId: purchaseRef.id,
        actor,
      });
    }

    for (const [id, running] of state) {
      tx.update(materialRef(db, id), {
        stock: running.stock,
        avgCost: running.avgCost,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    tx.create(purchaseRef, {
      date: Timestamp.fromDate(input.date),
      ...(input.supplier ? { supplier: input.supplier } : {}),
      ...(input.note ? { note: input.note } : {}),
      items,
      totalCost,
      createdAt: FieldValue.serverTimestamp(),
      actor,
    });
    appendAuditEntry(db, tx, {
      actor,
      action: "purchase.record",
      entity: "purchase",
      entityId: purchaseRef.id,
    });

    return { id: purchaseRef.id };
  });
}

function toPurchaseItem(raw: unknown): PurchaseItem | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const item = raw as Record<string, unknown>;
  return {
    materialId: readString(item.materialId),
    materialName: readString(item.materialName),
    qty: readNumber(item.qty),
    totalCost: readCentavos(item.totalCost),
  };
}

function toPurchase(doc: DocumentSnapshot): Purchase {
  const data = doc.data() ?? {};
  const rawItems: unknown[] = Array.isArray(data.items) ? data.items : [];

  return {
    id: doc.id,
    date: toDate(data.date),
    supplier: readOptionalString(data.supplier),
    note: readOptionalString(data.note),
    items: rawItems.flatMap((raw) => {
      const item = toPurchaseItem(raw);
      return item ? [item] : [];
    }),
    totalCost: readCentavos(data.totalCost),
  };
}

/**
 * One page of the purchases inside `range`, newest purchase date first
 * (1-based `page`). Fetches one extra document to learn whether a next page
 * exists. Returns `null` when Firebase isn't configured.
 */
export async function listPurchases(
  range: PeriodRange,
  page = 1,
): Promise<PurchasePage | null> {
  const db = getAdminDb();
  if (!db) {
    return null;
  }

  const snapshot = await db
    .collection(COLLECTIONS.purchases)
    .where("date", ">=", Timestamp.fromDate(range.start))
    .where("date", "<", Timestamp.fromDate(range.end))
    .orderBy("date", "desc")
    .offset(pageOffset(page, PURCHASES_PAGE_SIZE))
    .limit(PURCHASES_PAGE_SIZE + 1)
    .get();

  return {
    purchases: snapshot.docs.slice(0, PURCHASES_PAGE_SIZE).map(toPurchase),
    hasNextPage: snapshot.docs.length > PURCHASES_PAGE_SIZE,
  };
}

/**
 * What was invested inside `range`: the sum of every purchase's total, in
 * integer centavos, computed here on the server over ALL of the period (not
 * just the visible page). Reads only the `totalCost` field.
 *
 * It sums the documents instead of using Firestore's `sum()` aggregation on
 * purpose: an aggregation over `totalCost` filtered by `date` needs a
 * composite index, and this module's rule is none. Returns `null` when
 * Firebase isn't configured.
 */
export async function sumPurchases(
  range: PeriodRange,
): Promise<PurchaseTotal | null> {
  const db = getAdminDb();
  if (!db) {
    return null;
  }

  const snapshot = await db
    .collection(COLLECTIONS.purchases)
    .where("date", ">=", Timestamp.fromDate(range.start))
    .where("date", "<", Timestamp.fromDate(range.end))
    .select("totalCost")
    .limit(PURCHASE_SUM_LIMIT + 1)
    .get();

  const counted = snapshot.docs.slice(0, PURCHASE_SUM_LIMIT);
  return {
    totalCost: counted.reduce(
      (sum, doc) => sum + readCentavos(doc.data().totalCost),
      0,
    ),
    count: counted.length,
    truncated: snapshot.docs.length > PURCHASE_SUM_LIMIT,
  };
}
