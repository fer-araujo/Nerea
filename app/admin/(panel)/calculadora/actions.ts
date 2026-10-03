"use server";

import { requireAdmin } from "@/lib/admin/auth/session";
import {
  failure,
  failureFromError,
  type ActionResult,
} from "@/lib/admin/action-result";
import { recordCasting } from "@/lib/admin/data/castings";
import { isGoldMetal } from "@/lib/admin/domain/casting";
import { formText } from "@/lib/admin/form-data";
import { revalidateLedgerViews } from "@/lib/admin/revalidate";
import {
  firstIssueMessage,
  registerCastingSchema,
} from "@/lib/admin/schemas";

/**
 * "Registrar vaciado": stores the casting and consumes the chosen fine-metal
 * and alloy materials. Authorizes FIRST, then validates the untrusted
 * FormData with zod, then hands the RAW inputs to the data layer — which
 * recomputes metal, fine and alloy itself. The figures the calculator showed
 * in the browser are never sent, and would not be believed if they were.
 */
export async function registerCastingAction(
  formData: FormData,
): Promise<ActionResult> {
  const admin = await requireAdmin();

  if (!(formData instanceof FormData)) {
    return failure("invalid");
  }
  const parsed = registerCastingSchema.safeParse({
    metal: formText(formData, "metal"),
    color: formText(formData, "color"),
    waxGrams: formText(formData, "waxGrams"),
    density: formText(formData, "density"),
    fineness: formText(formData, "fineness"),
    allowancePercent: formText(formData, "allowancePercent"),
    recycledGrams: formText(formData, "recycledGrams"),
    fineMaterialId: formText(formData, "fineMaterialId"),
    alloyMaterialId: formText(formData, "alloyMaterialId"),
    date: formText(formData, "date"),
    note: formText(formData, "note"),
  });
  if (!parsed.success) {
    return failure("invalid", firstIssueMessage(parsed.error));
  }

  const input = parsed.data;
  try {
    const recorded = await recordCasting(
      {
        date: input.date,
        metal: input.metal,
        // Silver has no color; ignore one if a stale field was submitted.
        color: isGoldMetal(input.metal) ? input.color : undefined,
        waxGrams: input.waxGrams,
        density: input.density,
        fineness: input.fineness,
        allowance: input.allowancePercent / 100,
        recycledGrams: input.recycledGrams,
        fineMaterialId: input.fineMaterialId,
        alloyMaterialId: input.alloyMaterialId,
        note: input.note,
      },
      admin.uid,
    );
    // `null` = Firebase not configured.
    if (!recorded) {
      return failure("unavailable");
    }
  } catch (error) {
    return failureFromError(error);
  }

  revalidateLedgerViews();
  return { ok: true };
}
