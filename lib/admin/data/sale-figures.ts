import "server-only";
import type { DocumentData } from "firebase-admin/firestore";
import {
  SALE_SOURCES,
  SALE_STATUSES,
  resolveLivemode,
  type SaleFigures,
} from "@/lib/admin/domain/sales";
import {
  readCentavos,
  readEnum,
  readOptionalCentavos,
} from "./shared";

// ONE reader of the figures a sale contributes to a total, shared by the Ventas
// totals (sales.ts) and the Resumen dashboard (summary.ts), so the two can never
// read a document differently: in particular, which sales are test-mode and how
// a commission is read.
//
// Documents are only written by this folder but can be edited by hand in the
// Firebase console, so every field is coerced instead of trusted.

/**
 * The stored fields `readSaleFigures` reads: what a query that only needs the
 * figures `select`s (so nothing else, a note or the items, is ever read).
 */
export const SALE_FIGURE_FIELDS = [
  "status",
  "subtotal",
  "shipping",
  "total",
  "costOfGoods",
  "costPending",
  "source",
  "livemode",
  "stripeSessionId",
  "stripeFee",
  "terminalFee",
] as const;

export function readSaleFigures(data: DocumentData): SaleFigures {
  const source = readEnum(data.source, SALE_SOURCES, "manual");
  // `null` = the fee was never stored (the webhook could not read it yet, or the
  // sale predates the field): different from a stored 0.
  const stripeFee = readOptionalCentavos(data.stripeFee);

  return {
    status: readEnum(data.status, SALE_STATUSES, "active"),
    subtotal: readCentavos(data.subtotal),
    shipping: readCentavos(data.shipping),
    total: readCentavos(data.total),
    costOfGoods: readCentavos(data.costOfGoods),
    costPending: data.costPending === true,
    // A document from before `livemode` existed is judged by its session id.
    livemode: resolveLivemode(data.livemode, data.stripeSessionId),
    // A Stripe sale's commission is Stripe's fee; a manual sale's is the
    // terminal's, 0 when none was typed.
    fee: source === "stripe" ? (stripeFee ?? 0) : readCentavos(data.terminalFee),
    // Pending means "not read from Stripe yet", whatever the flag says: a Stripe
    // sale with no usable fee is offered a refresh either way.
    feePending: source === "stripe" && stripeFee === null,
  };
}
