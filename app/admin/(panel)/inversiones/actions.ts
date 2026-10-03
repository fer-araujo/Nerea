"use server";

import { requireAdmin } from "@/lib/admin/auth/session";
import {
  failure,
  failureFromError,
  type ActionResult,
} from "@/lib/admin/action-result";
import { recordPurchase } from "@/lib/admin/data/purchases";
import { formText, formTexts } from "@/lib/admin/form-data";
import { revalidateLedgerViews } from "@/lib/admin/revalidate";
import { firstIssueMessage, recordPurchaseSchema } from "@/lib/admin/schemas";

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
