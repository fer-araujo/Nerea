import { castingErrorMessage } from "./copy";
import { CastingInputError } from "./domain/casting";
import { InventoryError, type InventoryErrorCode } from "./domain/inventory";
import { SalesError, type SalesErrorCode } from "./domain/sales";

// The typed result every admin Server Action returns. It is deliberately
// small and value-free: an error code plus a fixed Spanish sentence. Nothing
// about the underlying failure — a Firestore error, a stored amount — ever
// travels to the browser.
//
// Lives outside the "use server" files because those may only export async
// functions; types and helpers shared by several actions go here.
export type ActionErrorCode =
  | InventoryErrorCode
  | SalesErrorCode
  | "invalid"
  | "unavailable"
  | "failed";

export type ActionFailure = {
  ok: false;
  error: ActionErrorCode;
  message: string;
};

// The action DID what was asked, but something around it needs the admin's
// attention (today: the sale is recorded, yet some pieces could not be marked
// as sold in the store). It is a success, so the form still clears; the warning
// is shown next to the confirmation.
export type ActionWarningCode = "store-not-updated";

export type ActionWarning = {
  code: ActionWarningCode;
  message: string;
};

export type ActionSuccess = { ok: true; warning?: ActionWarning };

export type ActionResult = ActionSuccess | ActionFailure;

const DEFAULT_MESSAGES: Readonly<Record<ActionErrorCode, string>> = {
  invalid: "Revisa los datos del formulario.",
  "invalid-quantity":
    "La cantidad no es válida para este material (hasta 2 decimales en gramos, números enteros en piezas).",
  "invalid-cost": "El costo no es válido.",
  "insufficient-stock": "Las existencias no alcanzan para esta operación.",
  "material-not-found": "El material ya no existe. Recarga la página.",
  "invalid-material": "El material elegido no sirve para esta operación.",
  "piece-not-found":
    "Una de las piezas ya no existe en el catálogo. Recarga la página.",
  "piece-unavailable":
    "Una de las piezas ya está vendida. Recarga la página para ver las que siguen disponibles.",
  "sale-not-found": "La venta ya no existe. Recarga la página.",
  "sale-not-voidable":
    "Solo se pueden anular las ventas manuales y las de prueba.",
  "fee-not-refreshable":
    "Solo las ventas de la tienda en línea tienen una comisión de Stripe que actualizar.",
  "fee-unavailable":
    "Stripe todavía no entrega la comisión de esta venta. Inténtalo de nuevo en unos minutos.",
  "invalid-sale": "La venta no es válida. Revisa las piezas y los montos.",
  unavailable:
    "El servicio no está disponible por ahora. Inténtalo de nuevo en unos minutos.",
  failed: "No se pudo guardar. Inténtalo de nuevo.",
};

export function failure(
  error: ActionErrorCode,
  message: string = DEFAULT_MESSAGES[error],
): ActionFailure {
  return { ok: false, error, message };
}

// Names the pieces by title (what the admin sees on every list), so she knows
// exactly which ones to mark in Studio. Titles are rendered as React text, never
// as HTML.
function storeNotUpdatedMessage(pieces: readonly string[]): string {
  const names = pieces.map((name) => `«${name}»`).join(", ");
  return pieces.length === 1
    ? `La venta quedó registrada, pero no se pudo marcar como vendida en la tienda la pieza ${names}. Márcala como vendida desde Studio.`
    : `La venta quedó registrada, pero no se pudo marcar como vendidas en la tienda las piezas ${names}. Márcalas como vendidas desde Studio.`;
}

/**
 * A success that still carries something the admin has to do: the sale is
 * recorded, but these pieces (by title) are still on sale in the store.
 */
export function successWithStoreWarning(pieces: readonly string[]): ActionSuccess {
  return {
    ok: true,
    warning: {
      code: "store-not-updated",
      message: storeNotUpdatedMessage(pieces),
    },
  };
}

/**
 * Turns whatever the data layer threw into a typed failure. Only the domain
 * error classes are recognised; anything else (Firestore down, a bug) is the
 * generic "failed" — and is not logged here, it could carry values.
 */
export function failureFromError(error: unknown): ActionFailure {
  if (error instanceof InventoryError || error instanceof SalesError) {
    return failure(error.code);
  }
  if (error instanceof CastingInputError) {
    return failure("invalid", castingErrorMessage(error));
  }
  return failure("failed");
}
