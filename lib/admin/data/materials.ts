import "server-only";
import {
  FieldValue,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type Transaction,
} from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/admin/firebase/admin";
import {
  InventoryError,
  MATERIAL_KINDS,
  MOVEMENT_TYPES,
  moveStock,
  movementValue,
  type AdjustmentKind,
  type MaterialKind,
  type MovementType,
} from "@/lib/admin/domain/inventory";
import { MATERIAL_UNITS, type MaterialUnit } from "@/lib/admin/domain/quantity";
import { pageOffset } from "@/lib/admin/pagination";
import { appendAuditEntry } from "./audit-log";
import {
  COLLECTIONS,
  isDocumentId,
  readCentavos,
  readEnum,
  readNumber,
  readOptionalString,
  readString,
  toDate,
} from "./shared";

// The materials ledger: `materials/{id}` holds the CURRENT stock and average
// cost; `materials/{id}/movements/{id}` is the append-only history behind it.
//
// Two rules hold for every function here and in purchases.ts / castings.ts:
//   - stock and avgCost change ONLY inside a Firestore transaction (read the
//     material, apply a pure rule from lib/admin/domain/inventory, write the
//     result and its movement together), so two overlapping requests can't
//     lose an update or drive stock below zero;
//   - movements are only ever CREATED (appendMovement below is the single
//     writer) — never updated or deleted. A mistake is corrected by a new,
//     reasoned adjustment, so the ledger can always be audited.
//
// Contract, as in contact-messages.ts: "Firebase not configured" is an
// expected state, reported as `null`; a broken ledger rule rejects with an
// InventoryError (the code is the contract); any other failure rejects as is.

/** Materials are a short list (a jeweler's bench), so one bounded read. */
export const MATERIALS_LIMIT = 200;
export const MOVEMENTS_PAGE_SIZE = 25;

export interface Material {
  id: string;
  name: string;
  kind: MaterialKind;
  unit: MaterialUnit;
  /** Units on hand, a multiple of 0.01. */
  stock: number;
  /** Average cost, integer centavos per unit. */
  avgCost: number;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface StockMovement {
  id: string;
  type: MovementType;
  /** Signed: positive adds stock, negative removes it. */
  qty: number;
  /** Centavos per unit when the movement had a price, else null. */
  unitCost: number | null;
  /** Centavos, a magnitude (the sign lives in `qty`), else null. */
  totalCost: number | null;
  refId: string | null;
  note: string | null;
  createdAt: Date | null;
}

export interface MovementPage {
  movements: StockMovement[];
  hasNextPage: boolean;
}

export function toMaterial(doc: DocumentSnapshot): Material {
  const data = doc.data() ?? {};

  return {
    id: doc.id,
    name: readString(data.name),
    kind: readEnum(data.kind, MATERIAL_KINDS, "other"),
    unit: readEnum(data.unit, MATERIAL_UNITS, "g"),
    stock: readNumber(data.stock),
    avgCost: readCentavos(data.avgCost),
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  };
}

export function materialRef(db: Firestore, id: string): DocumentReference {
  return db.collection(COLLECTIONS.materials).doc(id);
}

export interface NewMovement {
  type: MovementType;
  qty: number;
  unitCost?: number;
  totalCost?: number;
  refId?: string;
  note?: string;
  /** Opaque uid of the admin. */
  actor: string;
}

/**
 * THE writer of the movements ledger. `tx.create` (not `set`) makes
 * Firestore itself refuse to overwrite an existing movement, and nothing in
 * the codebase updates or deletes one. Fields are listed explicitly and
 * optional ones are omitted rather than stored as `undefined`, which
 * Firestore rejects.
 */
export function appendMovement(
  tx: Transaction,
  materialDoc: DocumentReference,
  movement: NewMovement,
): void {
  tx.create(materialDoc.collection(COLLECTIONS.movements).doc(), {
    type: movement.type,
    qty: movement.qty,
    ...(movement.unitCost !== undefined ? { unitCost: movement.unitCost } : {}),
    ...(movement.totalCost !== undefined
      ? { totalCost: movement.totalCost }
      : {}),
    ...(movement.refId !== undefined ? { refId: movement.refId } : {}),
    ...(movement.note !== undefined ? { note: movement.note } : {}),
    createdAt: FieldValue.serverTimestamp(),
    actor: movement.actor,
  });
}

/** All materials, by name. Returns `null` when Firebase isn't configured. */
export async function listMaterials(): Promise<Material[] | null> {
  const db = getAdminDb();
  if (!db) {
    return null;
  }

  const snapshot = await db
    .collection(COLLECTIONS.materials)
    .orderBy("name")
    .limit(MATERIALS_LIMIT)
    .get();

  return snapshot.docs.map(toMaterial);
}

export interface NewMaterialInput {
  name: string;
  kind: MaterialKind;
  unit: MaterialUnit;
}

/**
 * Creates a material with nothing on hand. Stock only ever arrives through a
 * purchase (opening inventory is registered as one), so a new material starts
 * at 0 and cannot be created with a made-up balance. Returns `null` when
 * Firebase isn't configured.
 */
export async function createMaterial(
  input: NewMaterialInput,
  actor: string,
): Promise<{ id: string } | null> {
  const db = getAdminDb();
  if (!db) {
    return null;
  }

  return db.runTransaction(async (tx) => {
    const ref = db.collection(COLLECTIONS.materials).doc();

    tx.create(ref, {
      name: input.name,
      kind: input.kind,
      unit: input.unit,
      stock: 0,
      avgCost: 0,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    appendAuditEntry(db, tx, {
      actor,
      action: "material.create",
      entity: "material",
      entityId: ref.id,
    });

    return { id: ref.id };
  });
}

export interface AdjustStockInput {
  materialId: string;
  /** Signed change in the material's unit. */
  delta: number;
  kind: AdjustmentKind;
  /** Why — required, stored on the movement as its note. */
  reason: string;
}

/**
 * A reasoned manual correction (count mismatch, loss in the workshop).
 * Changes `stock` by `delta` and records a movement; it never changes
 * avgCost — only a purchase re-prices inventory. Rejects with an
 * InventoryError when the material is missing, the quantity doesn't fit its
 * unit, a "loss" isn't negative, or the result would be below zero. Returns
 * `null` when Firebase isn't configured.
 */
export async function adjustStock(
  input: AdjustStockInput,
  actor: string,
): Promise<{ stock: number } | null> {
  if (!isDocumentId(input.materialId)) {
    throw new InventoryError("material-not-found");
  }
  if (input.kind === "loss" && !(input.delta < 0)) {
    throw new InventoryError("invalid-quantity");
  }

  const db = getAdminDb();
  if (!db) {
    return null;
  }

  return db.runTransaction(async (tx) => {
    const ref = materialRef(db, input.materialId);
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) {
      throw new InventoryError("material-not-found");
    }
    const material = toMaterial(snapshot);

    const next = moveStock(
      { stock: material.stock, avgCost: material.avgCost },
      material.unit,
      input.delta,
    );

    tx.update(ref, {
      stock: next.stock,
      updatedAt: FieldValue.serverTimestamp(),
    });
    appendMovement(tx, ref, {
      type: input.kind,
      qty: input.delta,
      // The value of what was written off, at the cost it carried.
      unitCost: material.avgCost,
      totalCost: movementValue(material.avgCost, input.delta),
      note: input.reason,
      actor,
    });
    appendAuditEntry(db, tx, {
      actor,
      action: "stock.adjust",
      entity: "material",
      entityId: ref.id,
    });

    return { stock: next.stock };
  });
}

function toMovement(doc: DocumentSnapshot): StockMovement {
  const data = doc.data() ?? {};

  return {
    id: doc.id,
    type: readEnum(data.type, MOVEMENT_TYPES, "adjustment"),
    qty: readNumber(data.qty),
    unitCost: typeof data.unitCost === "number" ? readCentavos(data.unitCost) : null,
    totalCost:
      typeof data.totalCost === "number" ? readCentavos(data.totalCost) : null,
    refId: readOptionalString(data.refId),
    note: readOptionalString(data.note),
    createdAt: toDate(data.createdAt),
  };
}

/**
 * One page of a material's movement history, newest first (1-based `page`).
 * Ordered by `createdAt` alone — the movements live in the material's own
 * subcollection, so no composite index is involved. Fetches one extra
 * document to learn whether a next page exists. Returns `null` for a
 * malformed id or when Firebase isn't configured.
 */
export async function listMovements(
  materialId: string,
  page = 1,
): Promise<MovementPage | null> {
  if (!isDocumentId(materialId)) {
    return null;
  }

  const db = getAdminDb();
  if (!db) {
    return null;
  }

  const snapshot = await materialRef(db, materialId)
    .collection(COLLECTIONS.movements)
    .orderBy("createdAt", "desc")
    .offset(pageOffset(page, MOVEMENTS_PAGE_SIZE))
    .limit(MOVEMENTS_PAGE_SIZE + 1)
    .get();

  return {
    movements: snapshot.docs.slice(0, MOVEMENTS_PAGE_SIZE).map(toMovement),
    hasNextPage: snapshot.docs.length > MOVEMENTS_PAGE_SIZE,
  };
}
