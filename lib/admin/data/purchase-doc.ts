import "server-only";
import {
  FieldValue,
  Timestamp,
  type DocumentReference,
  type Firestore,
  type Transaction,
} from "firebase-admin/firestore";
import { appendAuditEntry } from "./audit-log";

// THE writer of `purchases/{id}` documents. A purchase is created from two
// places that must agree on its shape: "Registrar compra" (purchases.ts) and a
// new material's opening stock (materials.ts, which cannot import purchases.ts
// without a cycle). Both go through here, inside their own transaction.

export interface PurchaseLine {
  materialId: string;
  /** Copied from the database, never taken from the caller. */
  materialName: string;
  qty: number;
  /** What this line cost in total, integer centavos. */
  totalCost: number;
}

export interface NewPurchaseDocument {
  /** The business date: the instant that day begins in Mexico City. */
  date: Date;
  /** Who it was bought from, or a concept like "Inventario inicial". */
  supplier?: string;
  note?: string;
  items: PurchaseLine[];
  totalCost: number;
  /**
   * The opening stock of a new material. It stays in the inventory's value but
   * is NOT an investment of its period (see sumPurchases and the Resumen).
   */
  initial?: boolean;
  /** Opaque uid of the admin. */
  actor: string;
}

/**
 * Creates the purchase and its audit entry in the caller's transaction. Fields
 * are listed explicitly and optional ones omitted rather than stored as
 * `undefined`, which Firestore rejects; `initial` is written only when true, so
 * an ordinary purchase keeps exactly the shape it always had.
 */
export function createPurchaseDocument(
  db: Firestore,
  tx: Transaction,
  ref: DocumentReference,
  purchase: NewPurchaseDocument,
): void {
  tx.create(ref, {
    date: Timestamp.fromDate(purchase.date),
    ...(purchase.supplier ? { supplier: purchase.supplier } : {}),
    ...(purchase.note ? { note: purchase.note } : {}),
    ...(purchase.initial ? { initial: true } : {}),
    items: purchase.items,
    totalCost: purchase.totalCost,
    createdAt: FieldValue.serverTimestamp(),
    actor: purchase.actor,
  });
  appendAuditEntry(db, tx, {
    actor: purchase.actor,
    action: "purchase.record",
    entity: "purchase",
    entityId: ref.id,
  });
}
