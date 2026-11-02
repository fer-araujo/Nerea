"use server";

import { requireAdmin } from "@/lib/admin/auth/session";
import {
  failure,
  failureFromError,
  successWithStockWarning,
  type ActionResult,
} from "@/lib/admin/action-result";
import {
  markSaleOversold,
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
import { updateProductsAfterSale } from "@/lib/commerce/revalidate";
import { decrementStock } from "@/lib/commerce/sanity/stock";

// Same order as every admin action: authorize FIRST, then validate the
// untrusted FormData with zod, then touch the data layer, then answer with a
// typed, value-free result. Nothing here logs anything: a field could carry an
// amount or a note.

/**
 * "Registrar venta": a sale made outside the online shop. The pieces arrive as
 * four parallel repeated fields — itemHandle, itemPrice, itemQuantity,
 * itemOption — one value per row; if they don't line up the request was not
 * produced by the form, and it is refused.
 *
 * The sale is recorded FIRST: it is the source of truth. Only then, if asked
 * ("Descontar de la tienda"), are the sold units taken off the stock in Sanity,
 * and any piece that could not be updated (no write token, Sanity down, a
 * transaction that failed) comes back in a typed warning that NAMES it, while
 * the sale stays recorded — the other order would leave units gone from the
 * store with no sale behind them, and a retry would then be refused because
 * the stock no longer covers it. A piece that had fewer units than were sold
 * ends at 0, is named in an "oversold" warning, and flags the sale
 * "Revisar: sobreventa".
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
  const quantities = formTexts(formData, "itemQuantity");
  const options = formTexts(formData, "itemOption");
  if (
    handles.length !== prices.length ||
    handles.length !== quantities.length ||
    handles.length !== options.length
  ) {
    return failure("invalid");
  }

  const parsed = recordManualSaleSchema.safeParse({
    date: formText(formData, "date"),
    shipping: formText(formData, "shipping"),
    terminalFee: formText(formData, "terminalFee"),
    note: formText(formData, "note"),
    // A checkbox posts its value when ticked and nothing at all when not.
    decrementStock: formText(formData, "decrementStock") === "on",
    items: handles.map((handle, index) => ({
      handle,
      price: prices[index],
      quantity: quantities[index],
      option: options[index],
    })),
  });
  if (!parsed.success) {
    return failure("invalid", firstIssueMessage(parsed.error));
  }
  const { decrementStock: takeOffStock, ...sale } = parsed.data;

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

  // `decrementStock` never throws: what it could not update comes back in
  // `failed` (a missing write token fails every piece, it is never a silent
  // no-op), and a product that vanished since the sale (`missing`) is nothing
  // to warn about.
  const notUpdated: string[] = [];
  const oversold: string[] = [];
  if (takeOffStock) {
    // Keyed on the sale's id: the stock is taken off once per (sale, piece),
    // however many times this runs.
    const result = await decrementStock(
      recorded.items.map((item) => ({ handle: item.handle, qty: item.quantity })),
      recorded.id,
    );
    // The units that were taken off are gone from the shelf: expire the cached
    // catalog so the storefront stops offering them (best-effort: the sale is
    // already recorded and must not turn into an error here).
    if (result.decremented.length > 0) {
      updateProductsAfterSale();
    }
    const titles = new Map(recorded.items.map((item) => [item.handle, item.title]));
    const titleOf = (handle: string) => titles.get(handle) ?? handle;
    notUpdated.push(...result.failed.map(titleOf));
    oversold.push(...result.oversold.map(titleOf));

    // Put the mark on the sale itself, where "Revisar: sobreventa" is read
    // from. If even that fails the warning below still tells the admin.
    if (result.oversold.length > 0) {
      try {
        await markSaleOversold(recorded.id);
      } catch {
        // Nothing to add: the warning already names the pieces.
      }
    }
  }

  revalidateSalesViews();
  return successWithStockWarning({ notUpdated, oversold });
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
