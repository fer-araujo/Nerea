"use server";

import { requireAdmin } from "@/lib/admin/auth/session";
import {
  failure,
  failureFromError,
  type ActionResult,
} from "@/lib/admin/action-result";
import {
  adjustStock,
  correctStock,
  createMaterial,
} from "@/lib/admin/data/materials";
import { recordPurchase } from "@/lib/admin/data/purchases";
import { formText, formTexts } from "@/lib/admin/form-data";
import { revalidateLedgerViews } from "@/lib/admin/revalidate";
import {
  adjustStockSchema,
  correctStockSchema,
  createMaterialSchema,
  firstIssueMessage,
  recordPurchaseSchema,
} from "@/lib/admin/schemas";

// Every action in this folder follows the same order: authorize FIRST (a
// Server Action is a public POST endpoint; the layout's check does not run
// for it), then validate the untrusted FormData with zod, then touch the
// data layer, then answer with a typed, value-free result. Nothing here logs
// anything: an error or a field could carry amounts or notes.

/**
 * "Nuevo material": a material starts empty, or with the opening stock she
 * already has (quantity and total cost). The opening stock is recorded in the
 * same transaction as an "Inventario inicial" purchase.
 */
export async function createMaterialAction(
  formData: FormData,
): Promise<ActionResult> {
  const admin = await requireAdmin();

  if (!(formData instanceof FormData)) {
    return failure("invalid");
  }
  const parsed = createMaterialSchema.safeParse({
    name: formText(formData, "name"),
    kind: formText(formData, "kind"),
    unit: formText(formData, "unit"),
    initialQty: formText(formData, "initialQty"),
    initialCost: formText(formData, "initialCost"),
  });
  if (!parsed.success) {
    return failure("invalid", firstIssueMessage(parsed.error));
  }

  try {
    // `null` = Firebase not configured.
    if (!(await createMaterial(parsed.data, admin.uid))) {
      return failure("unavailable");
    }
  } catch (error) {
    return failureFromError(error);
  }

  revalidateLedgerViews();
  return { ok: true };
}

/**
 * "Ajustar": a write-off (merma) or a physical count. Adding stock requires
 * the unit cost of what was added; the average is re-weighted with it.
 */
export async function adjustStockAction(
  formData: FormData,
): Promise<ActionResult> {
  const admin = await requireAdmin();

  if (!(formData instanceof FormData)) {
    return failure("invalid");
  }
  const parsed = adjustStockSchema.safeParse({
    materialId: formText(formData, "materialId"),
    delta: formText(formData, "delta"),
    kind: formText(formData, "kind"),
    unitCost: formText(formData, "unitCost"),
    reason: formText(formData, "reason"),
  });
  if (!parsed.success) {
    return failure("invalid", firstIssueMessage(parsed.error));
  }

  try {
    if (!(await adjustStock(parsed.data, admin.uid))) {
      return failure("unavailable");
    }
  } catch (error) {
    return failureFromError(error);
  }

  revalidateLedgerViews();
  return { ok: true };
}

/**
 * "Corregir": sets the real stock and the real average cost per unit, with a
 * reason. The way out of a wrong average.
 */
export async function correctStockAction(
  formData: FormData,
): Promise<ActionResult> {
  const admin = await requireAdmin();

  if (!(formData instanceof FormData)) {
    return failure("invalid");
  }
  const parsed = correctStockSchema.safeParse({
    materialId: formText(formData, "materialId"),
    stock: formText(formData, "stock"),
    avgCost: formText(formData, "avgCost"),
    reason: formText(formData, "reason"),
  });
  if (!parsed.success) {
    return failure("invalid", firstIssueMessage(parsed.error));
  }

  try {
    if (!(await correctStock(parsed.data, admin.uid))) {
      return failure("unavailable");
    }
  } catch (error) {
    return failureFromError(error);
  }

  revalidateLedgerViews();
  return { ok: true };
}

/**
 * "Registrar compra": one purchase, one or more material lines. Authorizes
 * FIRST, then validates the untrusted FormData with zod, then records the
 * purchase (stock, average cost and movements change in one transaction).
 *
 * The item rows arrive as three parallel repeated fields — itemMaterialId,
 * itemQty, itemCost — one value per row. If the three don't line up the
 * request was not produced by the form, and it is refused.
 */
export async function recordPurchaseAction(
  formData: FormData,
): Promise<ActionResult> {
  const admin = await requireAdmin();

  if (!(formData instanceof FormData)) {
    return failure("invalid");
  }

  const materialIds = formTexts(formData, "itemMaterialId");
  const quantities = formTexts(formData, "itemQty");
  const costs = formTexts(formData, "itemCost");
  if (
    materialIds.length !== quantities.length ||
    materialIds.length !== costs.length
  ) {
    return failure("invalid");
  }

  const parsed = recordPurchaseSchema.safeParse({
    date: formText(formData, "date"),
    supplier: formText(formData, "supplier"),
    note: formText(formData, "note"),
    items: materialIds.map((materialId, index) => ({
      materialId,
      qty: quantities[index],
      totalCost: costs[index],
    })),
  });
  if (!parsed.success) {
    return failure("invalid", firstIssueMessage(parsed.error));
  }

  try {
    // `null` = Firebase not configured.
    if (!(await recordPurchase(parsed.data, admin.uid))) {
      return failure("unavailable");
    }
  } catch (error) {
    return failureFromError(error);
  }

  revalidateLedgerViews();
  return { ok: true };
}
