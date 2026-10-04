"use server";

import { requireAdmin } from "@/lib/admin/auth/session";
import {
  failure,
  failureFromError,
  successWithStoreWarning,
  type ActionResult,
} from "@/lib/admin/action-result";
import {
  recordManualSale,
  refreshSaleFee,
  voidSale,
} from "@/lib/admin/data/sales";
import { formText, formTexts } from "@/lib/admin/form-data";
import { revalidateSalesViews } from "@/lib/admin/revalidate";
import {
  firstIssueMessage,
  recordManualSaleSchema,
  refreshSaleFeeSchema,
  voidSaleSchema,
} from "@/lib/admin/schemas";
import { markProductsSold } from "@/lib/commerce/sanity/mark-sold";

// Same order as every admin action: authorize FIRST, then validate the
// untrusted FormData with zod, then touch the data layer, then answer with a
// typed, value-free result. Nothing here logs anything: a field could carry an
// amount or a note.

/**
 * "Registrar venta": a sale made outside the online shop. The pieces arrive as
 * three parallel repeated fields — itemHandle, itemPrice, itemOption — one
 * value per row; if the three don't line up the request was not produced by the
 * form, and it is refused.
 *
 * The sale is recorded FIRST: it is the source of truth. Only then, if asked
 * ("Marcar como vendida en la tienda"), are the pieces marked sold in Sanity,
 * and any that could not be marked (no write token, Sanity down, a patch that
 * failed) come back in a typed warning that NAMES them, while the sale stays
 * recorded — the other order would leave a piece sold in the store with no sale
 * behind it, and a retry would then be refused because the piece is "sold".
 */
export async function recordManualSaleAction(
  formData: FormData,
): Promise<ActionResult> {
  const admin = await requireAdmin();

  if (!(formData instanceof FormData)) {
    return failure("invalid");
  }

  const handles = formTexts(formData, "itemHandle");
  const prices = formTexts(formData, "itemPrice");
  const options = formTexts(formData, "itemOption");
  if (handles.length !== prices.length || handles.length !== options.length) {
    return failure("invalid");
  }

  const parsed = recordManualSaleSchema.safeParse({
    date: formText(formData, "date"),
    shipping: formText(formData, "shipping"),
    terminalFee: formText(formData, "terminalFee"),
    note: formText(formData, "note"),
    // A checkbox posts its value when ticked and nothing at all when not.
    markSold: formText(formData, "markSold") === "on",
    items: handles.map((handle, index) => ({
      handle,
      price: prices[index],
      option: options[index],
    })),
  });
  if (!parsed.success) {
    return failure("invalid", firstIssueMessage(parsed.error));
  }
  const { markSold, ...sale } = parsed.data;

  let recorded: Awaited<ReturnType<typeof recordManualSale>>;
  try {
    recorded = await recordManualSale(sale, admin.uid);
  } catch (error) {
    return failureFromError(error);
  }
  // `null` = Firebase not configured.
  if (!recorded) {
    return failure("unavailable");
  }

  // `markProductsSold` never throws: what it could not mark comes back in
  // `failed` (a missing write token fails every piece, it is never a silent
  // no-op), and a product that vanished since the sale (`missing`) is nothing
  // to warn about.
  const notMarked: string[] = [];
  if (markSold) {
    const { failed } = await markProductsSold(
      recorded.items.map((item) => item.handle),
    );
    const titles = new Map(recorded.items.map((item) => [item.handle, item.title]));
    notMarked.push(...failed.map((handle) => titles.get(handle) ?? handle));
  }

  revalidateSalesViews();
  return notMarked.length === 0
    ? { ok: true }
    : successWithStoreWarning(notMarked);
}

/**
 * "Anular venta": a manual sale, or a Stripe sale made in test mode, stays on
 * record with `status: "void"` and leaves every total (a live Stripe sale is
 * refused: it is refunded in Stripe). It does not put the piece back on sale in
 * the store — that is a deliberate step in Studio.
 */
export async function voidSaleAction(
  formData: FormData,
): Promise<ActionResult> {
  const admin = await requireAdmin();

  if (!(formData instanceof FormData)) {
    return failure("invalid");
  }
  const parsed = voidSaleSchema.safeParse({
    saleId: formText(formData, "saleId"),
  });
  if (!parsed.success) {
    return failure("invalid", firstIssueMessage(parsed.error));
  }

  try {
    if (!(await voidSale(parsed.data.saleId, admin.uid))) {
      return failure("unavailable");
    }
  } catch (error) {
    return failureFromError(error);
  }

  revalidateSalesViews();
  return { ok: true };
}

/**
 * "Actualizar comisión": reads Stripe's fee and net for an online sale whose fee
 * could not be read when the payment came in, and stores them on the sale. Same
 * order as every admin action: authorize FIRST, validate the untrusted FormData,
 * then the data layer. The only thing taken from the request is the sale's id:
 * the Checkout Session id that Stripe is asked about comes from the stored sale.
 * A fee Stripe can't give yet is a typed, retryable failure, never a crash.
 */
export async function refreshSaleFeeAction(
  formData: FormData,
): Promise<ActionResult> {
  const admin = await requireAdmin();

  if (!(formData instanceof FormData)) {
    return failure("invalid");
  }
  const parsed = refreshSaleFeeSchema.safeParse({
    saleId: formText(formData, "saleId"),
  });
  if (!parsed.success) {
    return failure("invalid", firstIssueMessage(parsed.error));
  }

  try {
    if (!(await refreshSaleFee(parsed.data.saleId, admin.uid))) {
      return failure("unavailable");
    }
  } catch (error) {
    return failureFromError(error);
  }

  revalidateSalesViews();
  return { ok: true };
}
