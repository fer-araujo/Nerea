import "server-only";
import {
  FieldValue,
  type Firestore,
  type Transaction,
} from "firebase-admin/firestore";
import { COLLECTIONS } from "./shared";

export type AuditAction =
  | "material.create"
  | "stock.adjust"
  | "purchase.record"
  | "casting.record"
  | "piece.update"
  | "sale.record"
  | "sale.void";

export type AuditEntity =
  | "material"
  | "purchase"
  | "casting"
  | "piece"
  | "sale";

export interface AuditEntry {
  /** Opaque uid of the admin who did it, never an email address. */
  actor: string;
  action: AuditAction;
  entity: AuditEntity;
  entityId: string;
}

/**
 * Appends one `auditLog` entry INSIDE the caller's transaction, so a change
 * and its audit trail commit together or not at all.
 *
 * Records WHO did WHAT to WHICH document and WHEN — and deliberately no
 * values: no amounts, quantities, names or notes. The ledger already holds
 * those; the audit log must not become a second, unreviewed copy of them.
 * Fields are listed explicitly so nothing else can slip in.
 */
export function appendAuditEntry(
  db: Firestore,
  tx: Transaction,
  entry: AuditEntry,
): void {
  tx.create(db.collection(COLLECTIONS.auditLog).doc(), {
    actor: entry.actor,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId,
    at: FieldValue.serverTimestamp(),
  });
}
