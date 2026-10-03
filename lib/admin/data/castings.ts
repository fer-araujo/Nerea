import "server-only";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/admin/firebase/admin";
import {
  calculateCasting,
  type GoldColor,
  type MetalKey,
} from "@/lib/admin/domain/casting";
import {
  InventoryError,
  consumeStock,
  fineKindFor,
  movementValue,
  type MaterialKind,
} from "@/lib/admin/domain/inventory";
import { appendAuditEntry } from "./audit-log";
import { appendMovement, materialRef, toMaterial } from "./materials";
import { COLLECTIONS, isDocumentId } from "./shared";

// A registered casting ("vaciado"): the calculator's inputs and outputs are
// stored, and the fine metal and alloy it used are consumed from the chosen
// materials. Same transactional rules as materials.ts.

export interface RecordCastingInput {
  /** The business date: the instant that day begins in Mexico City. */
  date: Date;
  metal: MetalKey;
  /** Only meaningful for gold. */
  color?: GoldColor;
  waxGrams: number;
  density: number;
  fineness: number;
  /** A fraction: 0.10 = 10 %. */
  allowance: number;
  recycledGrams: number;
  /** Material the fine metal is drawn from (needed when fine > 0). */
  fineMaterialId?: string;
  /** Material the alloy is drawn from (needed when alloy > 0). */
  alloyMaterialId?: string;
  note?: string;
}

interface Pick {
  materialId: string;
  qty: number;
  /** The kinds of material allowed to supply this part of the pour. */
  kinds: readonly MaterialKind[];
}

/**
 * Registers a casting and consumes its materials.
 *
 * The outputs are RECOMPUTED here from the raw inputs with the same pure
 * functions the calculator uses; whatever the browser displayed is never
 * what gets stored or consumed. Silver draws fine silver, gold draws fine
 * gold, and the alloy must be an "alloy" material — all measured in grams.
 *
 * All or nothing: if either material is missing, of the wrong kind, or short
 * on stock (InventoryError "insufficient-stock"), NOTHING is written —
 * neither stock changes nor a casting document. A part of the pour that
 * weighs 0 g (everything recycled, or a fineness of 1) needs no material.
 * Rejects with a CastingInputError for inputs that can't be calculated, and
 * returns `null` when Firebase isn't configured.
 */
export async function recordCasting(
  input: RecordCastingInput,
  actor: string,
): Promise<{ id: string } | null> {
  const outputs = calculateCasting({
    waxGrams: input.waxGrams,
    density: input.density,
    fineness: input.fineness,
    allowance: input.allowance,
    recycledGrams: input.recycledGrams,
  });

  const picks: Pick[] = [];
  if (outputs.fine > 0) {
    picks.push({
      materialId: input.fineMaterialId ?? "",
      qty: outputs.fine,
      kinds: [fineKindFor(input.metal)],
    });
  }
  if (outputs.alloy > 0) {
    picks.push({
      materialId: input.alloyMaterialId ?? "",
      qty: outputs.alloy,
      kinds: ["alloy"],
    });
  }

  for (const pick of picks) {
    if (!isDocumentId(pick.materialId)) {
      throw new InventoryError("invalid-material");
    }
  }
  if (new Set(picks.map((pick) => pick.materialId)).size !== picks.length) {
    throw new InventoryError("invalid-material");
  }

  const db = getAdminDb();
  if (!db) {
    return null;
  }

  return db.runTransaction(async (tx) => {
    // Transactions need every read before the first write.
    const snapshots =
      picks.length > 0
        ? await tx.getAll(...picks.map((pick) => materialRef(db, pick.materialId)))
        : [];

    const castingRef = db.collection(COLLECTIONS.castings).doc();
    const consumed: Array<{
      materialId: string;
      qty: number;
      unitCost: number;
      totalCost: number;
    }> = [];

    picks.forEach((pick, index) => {
      const snapshot = snapshots[index];
      if (!snapshot.exists) {
        throw new InventoryError("material-not-found");
      }
      const material = toMaterial(snapshot);
      if (material.unit !== "g" || !pick.kinds.includes(material.kind)) {
        throw new InventoryError("invalid-material");
      }

      // Throws "insufficient-stock" rather than going below zero.
      const next = consumeStock(
        { stock: material.stock, avgCost: material.avgCost },
        material.unit,
        pick.qty,
      );

      // Snapshot of what this material cost when it was used, so the cost of
      // a casting can be read straight off the casting later.
      const totalCost = movementValue(material.avgCost, pick.qty);
      consumed.push({
        materialId: material.id,
        qty: pick.qty,
        unitCost: material.avgCost,
        totalCost,
      });

      tx.update(snapshot.ref, {
        stock: next.stock,
        updatedAt: FieldValue.serverTimestamp(),
      });
      appendMovement(tx, snapshot.ref, {
        type: "casting",
        qty: -pick.qty,
        unitCost: material.avgCost,
        totalCost,
        refId: castingRef.id,
        actor,
      });
    });

    tx.create(castingRef, {
      date: Timestamp.fromDate(input.date),
      inputs: {
        metal: input.metal,
        ...(input.color ? { color: input.color } : {}),
        waxGrams: input.waxGrams,
        density: input.density,
        fineness: input.fineness,
        allowance: input.allowance,
        recycledGrams: input.recycledGrams,
      },
      outputs: {
        metalGrams: outputs.metal,
        fineGrams: outputs.fine,
        alloyGrams: outputs.alloy,
        recycledGrams: outputs.recycled,
      },
      consumed,
      ...(input.note ? { note: input.note } : {}),
      createdAt: FieldValue.serverTimestamp(),
      actor,
    });
    appendAuditEntry(db, tx, {
      actor,
      action: "casting.record",
      entity: "casting",
      entityId: castingRef.id,
    });

    return { id: castingRef.id };
  });
}
