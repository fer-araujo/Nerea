"use server";

import { requireAdmin } from "@/lib/admin/auth/session";
import {
  failure,
  failureFromError,
  type ActionResult,
} from "@/lib/admin/action-result";
import { savePieceCost } from "@/lib/admin/data/pieces";
import { formText } from "@/lib/admin/form-data";
import { revalidatePieceViews } from "@/lib/admin/revalidate";
import { firstIssueMessage, savePieceCostSchema } from "@/lib/admin/schemas";

/**
 * "Guardar costo": records what one piece cost to make. Same order as every
 * admin action: authorize FIRST (a Server Action is a public POST endpoint;
 * the layout's check does not run for it), then validate the untrusted
 * FormData with zod, then touch the data layer, then answer with a typed,
 * value-free result. Nothing here logs anything: a field could carry a cost.
 *
 * The piece's PRICE is deliberately not a field: it lives in the catalog, and
 * a request must not be able to say what a piece sells for.
 */
export async function savePieceCostAction(
  formData: FormData,
): Promise<ActionResult> {
  const admin = await requireAdmin();

  if (!(formData instanceof FormData)) {
    return failure("invalid");
  }
  const parsed = savePieceCostSchema.safeParse({
    handle: formText(formData, "handle"),
    metal: formText(formData, "metal"),
    stones: formText(formData, "stones"),
    other: formText(formData, "other"),
    labor: formText(formData, "labor"),
    metalGrams: formText(formData, "metalGrams"),
    materialId: formText(formData, "materialId"),
    note: formText(formData, "note"),
  });
  if (!parsed.success) {
    return failure("invalid", firstIssueMessage(parsed.error));
  }

  try {
    // `null` = Firebase not configured.
    if (!(await savePieceCost(parsed.data, admin.uid))) {
      return failure("unavailable");
    }
  } catch (error) {
    return failureFromError(error);
  }

  revalidatePieceViews();
  return { ok: true };
}
