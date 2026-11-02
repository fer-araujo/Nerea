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
  INITIAL_PURCHASE_CONCEPT,
  InventoryError,
  MATERIAL_KINDS,
  MOVEMENT_TYPES,
  applyAdjustment,
  movementValue,
  planCorrection,
  receiveStock,
  type AdjustmentKind,
  type MaterialKind,
  type MovementType,
  type StockState,
} from "@/lib/admin/domain/inventory";
import { unitCostFromTotal } from "@/lib/admin/domain/money";
import { mexicoDateToInstant, mexicoTodayIso } from "@/lib/admin/domain/periods";
import { MATERIAL_UNITS, type MaterialUnit } from "@/lib/admin/domain/quantity";
import { pageOffset } from "@/lib/admin/pagination";
import { appendAuditEntry } from "./audit-log";
import { createPurchaseDocument } from "./purchase-doc";
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
// Three rules hold for every function here and in purchases.ts / castings.ts:
//   - stock and avgCost change ONLY inside a Firestore transaction (read the
//     material, apply a pure rule from lib/admin/domain/inventory, write the
//     result and its movement together), so two overlapping requests can't
//     lose an update or drive stock below zero;
//   - movements are only ever CREATED (appendMovement below is the single
//     writer) — never updated or deleted. A mistake is corrected by a new,
//     reasoned adjustment or correction, so the ledger can always be audited;
//   - the average cost changes in exactly three places: a purchase (including a
//     new material's opening stock), a positive count that states its unit cost,
//     and a correction. A loss or a negative count never moves it.
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
  /**
   * What she already has of it, with what it cost in total (integer centavos,
   * 0 allowed). Recorded as an opening-stock purchase in the SAME transaction,
   * so the stock and the average cost start right.
   */
  initial?: { qty: number; totalCost: number };
}

const EMPTY_STOCK: StockState = { stock: 0, avgCost: 0 };

/**
 * Creates a material. With nothing on hand it starts at 0; with an `initial`
 * quantity and cost it starts with that stock at that cost, and ONE transaction
 * writes the material, the "purchase" movement and a purchase document flagged
 * `initial` (concept "Inventario inicial"), so the history explains the
 * balance and the opening stock never counts as an investment of the period.
 * Rejects with an InventoryError when the quantity doesn't fit the unit or the
 * cost isn't valid. Returns `null` when Firebase isn't configured.
 */
export async function createMaterial(
  input: NewMaterialInput,
  actor: string,
): Promise<{ id: string } | null> {
  // Pure, so a bad opening quantity or cost is refused before the database.
  const opening = input.initial
    ? receiveStock(
        EMPTY_STOCK,
        input.unit,
        input.initial.qty,
        input.initial.totalCost,
      )
    : EMPTY_STOCK;

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
      stock: opening.stock,
      avgCost: opening.avgCost,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    if (input.initial) {
      const { qty, totalCost } = input.initial;
      const purchaseRef = db.collection(COLLECTIONS.purchases).doc();

      appendMovement(tx, ref, {
        type: "purchase",
        qty,
        unitCost: unitCostFromTotal(totalCost, qty),
        totalCost,
        refId: purchaseRef.id,
        actor,
      });
      createPurchaseDocument(db, tx, purchaseRef, {
        date: mexicoDateToInstant(mexicoTodayIso()),
        supplier: INITIAL_PURCHASE_CONCEPT,
        items: [
          { materialId: ref.id, materialName: input.name, qty, totalCost },
        ],
        totalCost,
        initial: true,
        actor,
      });
    }

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
  /**
   * What each added unit cost, integer centavos (0 allowed). REQUIRED when
   * `delta` is positive, ignored otherwise.
   */
  unitCost?: number;
  /** Why — required, stored on the movement as its note. */
  reason: string;
}

/**
 * A reasoned manual adjustment (a physical count that doesn't match, or metal
 * lost in the workshop). A negative `delta` lowers `stock` only. A positive one
 * must carry the `unitCost` of what was added and re-weights avgCost, exactly
 * like a purchase of those units (see applyAdjustment). Rejects with an
 * InventoryError when the material is missing, the quantity doesn't fit its
 * unit, a "loss" isn't negative, a positive count has no cost, or the result
 * would be below zero. Returns `null` when Firebase isn't configured.
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

    const next = applyAdjustment(
      { stock: material.stock, avgCost: material.avgCost },
      material.unit,
      input.kind,
      input.delta,
      input.unitCost,
    );
    // Units that came in carry the cost she stated; units that went out, the
    // cost they had on the shelf.
    const unitCost =
      input.delta > 0 && input.unitCost !== undefined
        ? input.unitCost
        : material.avgCost;

    tx.update(ref, {
      stock: next.stock,
      ...(next.avgCost !== material.avgCost ? { avgCost: next.avgCost } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    });
    appendMovement(tx, ref, {
      type: input.kind,
      qty: input.delta,
      unitCost,
      totalCost: movementValue(unitCost, input.delta),
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

export interface CorrectStockInput {
  materialId: string;
  /** The REAL units on hand (0 allowed). */
  stock: number;
  /** The REAL average cost, integer centavos per unit. */
  avgCost: number;
  /** Why — required, stored on the movement as its note. */
  reason: string;
}

/**
 * "Corregir": sets the real stock and the real average cost, whatever they were
 * (the way out of a wrong average, which further purchases would only dilute).
 * One transaction updates the material, appends a "correction" movement (the
 * signed change in stock, priced at the new average) and the audit entry, which
 * holds no values. Rejects with an InventoryError when the material is missing,
 * the stock doesn't fit its unit, the cost is invalid, or nothing would change.
 * Returns `null` when Firebase isn't configured.
 */
export async function correctStock(
  input: CorrectStockInput,
  actor: string,
): Promise<{ stock: number; avgCost: number } | null> {
  if (!isDocumentId(input.materialId)) {
    throw new InventoryError("material-not-found");
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

    const plan = planCorrection(
      { stock: material.stock, avgCost: material.avgCost },
      material.unit,
      { stock: input.stock, avgCost: input.avgCost },
    );

    tx.update(ref, {
      stock: plan.stock,
      avgCost: plan.avgCost,
      updatedAt: FieldValue.serverTimestamp(),
    });
    appendMovement(tx, ref, {
      type: "correction",
      qty: plan.delta,
      unitCost: plan.avgCost,
      totalCost: movementValue(plan.avgCost, plan.delta),
      note: input.reason,
      actor,
    });
    appendAuditEntry(db, tx, {
      actor,
      action: "stock.correct",
      entity: "material",
      entityId: ref.id,
    });

    return { stock: plan.stock, avgCost: plan.avgCost };
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
