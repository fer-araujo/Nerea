import "server-only";
import {
  FieldValue,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type Transaction,
} from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/admin/firebase/admin";
import { InventoryError } from "@/lib/admin/domain/inventory";
import { isCentavos } from "@/lib/admin/domain/money";
import { pieceCostTotal, type PieceCosts } from "@/lib/admin/domain/pieces";
import { SalesError } from "@/lib/admin/domain/sales";
import { appendAuditEntry } from "./audit-log";
import {
  COLLECTIONS,
  isDocumentId,
  isPieceHandle,
  readCentavos,
  readOptionalString,
  toDate,
} from "./shared";

// The cost side of the catalog. `pieces/{handle}` holds what one piece cost to
// make; the price and availability live in Sanity and are joined by handle on
// the page. A piece with no document has NO COST RECORDED ("costo pendiente"),
// which is different from a recorded cost of 0.
//
// Contract, as in materials.ts: "Firebase not configured" is an expected state
// reported as `null`; a broken rule rejects with a typed domain error; any
// other failure rejects as is. Queries read one collection with no filter, so
// no index is involved.

/** Bound on the cost documents read for the pieces page (> CATALOG_LIMIT). */
export const PIECES_LIMIT = 1000;

export interface PieceRecord {
  handle: string;
  costs: PieceCosts;
  /** Grams of metal the "Calcular metal" helper used, when it was used. */
  metalGrams: number | null;
  /** The material that helper priced the metal at, when it was used. */
  materialId: string | null;
  note: string | null;
  updatedAt: Date | null;
}

export function pieceRef(db: Firestore, handle: string): DocumentReference {
  return db.collection(COLLECTIONS.pieces).doc(handle);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

// Documents are written only by savePieceCost but can be edited by hand in the
// Firebase console, so every field is coerced instead of trusted.
export function toPieceRecord(doc: DocumentSnapshot): PieceRecord {
  const data = doc.data() ?? {};
  const costs = asRecord(data.costs);

  return {
    // The document id IS the handle; the stored copy is never believed over it.
    handle: doc.id,
    costs: {
      metal: readCentavos(costs.metal),
      stones: readCentavos(costs.stones),
      other: readCentavos(costs.other),
      ...(typeof costs.labor === "number"
        ? { labor: readCentavos(costs.labor) }
        : {}),
    },
    metalGrams:
      typeof data.metalGrams === "number" &&
      Number.isFinite(data.metalGrams) &&
      data.metalGrams > 0
        ? data.metalGrams
        : null,
    materialId: readOptionalString(data.materialId),
    note: readOptionalString(data.note),
    updatedAt: toDate(data.updatedAt),
  };
}

/**
 * Every piece that has a cost recorded. Returns `null` when Firebase isn't
 * configured.
 */
export async function listPieces(): Promise<PieceRecord[] | null> {
  const db = getAdminDb();
  if (!db) {
    return null;
  }

  const snapshot = await db
    .collection(COLLECTIONS.pieces)
    .limit(PIECES_LIMIT)
    .get();

  return snapshot.docs.map(toPieceRecord);
}

/**
 * Reads, INSIDE the caller's transaction, the total cost of each handle that
 * has one recorded; a handle with no document (or one that can't be an id)
 * is simply absent from the map. This is what lets a sale freeze its cost in
 * the same transaction that writes it. Transactions need every read before
 * the first write, so call this before writing anything.
 */
export async function readPieceCostTotals(
  db: Firestore,
  tx: Transaction,
  handles: readonly string[],
): Promise<Map<string, number>> {
  const unique = [...new Set(handles)].filter(isPieceHandle);
  const totals = new Map<string, number>();
  if (unique.length === 0) {
    return totals;
  }

  const snapshots = await tx.getAll(...unique.map((handle) => pieceRef(db, handle)));
  for (const snapshot of snapshots) {
    if (snapshot.exists) {
      totals.set(snapshot.id, pieceCostTotal(toPieceRecord(snapshot).costs));
    }
  }
  return totals;
}

export interface SavePieceCostInput {
  handle: string;
  costs: PieceCosts;
  metalGrams?: number;
  materialId?: string;
  note?: string;
}

/**
 * Records (or replaces) the cost of one piece, with its audit entry, in one
 * transaction. The whole document is replaced, so a field the admin cleared
 * (a note, the labor) really disappears. Fields are listed explicitly and
 * optional ones are omitted rather than stored as `undefined`, which
 * Firestore rejects.
 *
 * Rejects with a SalesError "piece-not-found" for a handle that can't be an
 * id, an InventoryError "invalid-cost" for a cost that isn't whole centavos,
 * and returns `null` when Firebase isn't configured.
 */
export async function savePieceCost(
  input: SavePieceCostInput,
  actor: string,
): Promise<{ handle: string } | null> {
  if (!isPieceHandle(input.handle)) {
    throw new SalesError("piece-not-found");
  }
  const { metal, stones, other, labor } = input.costs;
  const costValues = labor === undefined ? [metal, stones, other] : [metal, stones, other, labor];
  if (!costValues.every(isCentavos)) {
    throw new InventoryError("invalid-cost");
  }
  if (
    input.metalGrams !== undefined &&
    !(Number.isFinite(input.metalGrams) && input.metalGrams > 0)
  ) {
    throw new InventoryError("invalid-quantity");
  }
  if (input.materialId !== undefined && !isDocumentId(input.materialId)) {
    throw new InventoryError("material-not-found");
  }

  const db = getAdminDb();
  if (!db) {
    return null;
  }

  return db.runTransaction(async (tx) => {
    tx.set(pieceRef(db, input.handle), {
      handle: input.handle,
      costs: {
        metal,
        stones,
        other,
        ...(labor !== undefined ? { labor } : {}),
      },
      ...(input.metalGrams !== undefined ? { metalGrams: input.metalGrams } : {}),
      ...(input.materialId !== undefined ? { materialId: input.materialId } : {}),
      ...(input.note ? { note: input.note } : {}),
      updatedAt: FieldValue.serverTimestamp(),
      actor,
    });
    // Who changed WHICH piece, never what the cost was.
    appendAuditEntry(db, tx, {
      actor,
      action: "piece.update",
      entity: "piece",
      entityId: input.handle,
    });

    return { handle: input.handle };
  });
}
