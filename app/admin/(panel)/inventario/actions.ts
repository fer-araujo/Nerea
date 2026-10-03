"use server";

import { requireAdmin } from "@/lib/admin/auth/session";
import {
  failure,
  failureFromError,
  type ActionResult,
} from "@/lib/admin/action-result";
import { adjustStock, createMaterial } from "@/lib/admin/data/materials";
import { formText } from "@/lib/admin/form-data";
import { revalidateLedgerViews } from "@/lib/admin/revalidate";
import {
  adjustStockSchema,
  createMaterialSchema,
  firstIssueMessage,
} from "@/lib/admin/schemas";

// Every action in this folder follows the same order: authorize FIRST (a
// Server Action is a public POST endpoint; the layout's check does not run
// for it), then validate the untrusted FormData with zod, then touch the
// data layer, then answer with a typed, value-free result. Nothing here logs
// anything: an error or a field could carry amounts or notes.

/** "Nuevo material": a material starts empty; stock arrives via a purchase. */
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

/** "Ajustar existencias": a reasoned correction or write-off. */
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
