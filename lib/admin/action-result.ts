import { castingErrorMessage } from "./copy";
import { CastingInputError } from "./domain/casting";
import { InventoryError, type InventoryErrorCode } from "./domain/inventory";

// The typed result every inventory Server Action returns. It is deliberately
// small and value-free: an error code plus a fixed Spanish sentence. Nothing
// about the underlying failure — a Firestore error, a stored amount — ever
// travels to the browser.
//
// Lives outside the "use server" files because those may only export async
// functions; types and helpers shared by several actions go here.
export type ActionErrorCode = InventoryErrorCode | "invalid" | "unavailable" | "failed";

export type ActionFailure = {
  ok: false;
  error: ActionErrorCode;
  message: string;
};

export type ActionResult = { ok: true } | ActionFailure;

const DEFAULT_MESSAGES: Readonly<Record<ActionErrorCode, string>> = {
  invalid: "Revisa los datos del formulario.",
  "invalid-quantity":
    "La cantidad no es válida para este material (hasta 2 decimales en gramos, números enteros en piezas).",
  "invalid-cost": "El costo no es válido.",
  "insufficient-stock": "Las existencias no alcanzan para esta operación.",
  "material-not-found": "El material ya no existe. Recarga la página.",
  "invalid-material": "El material elegido no sirve para esta operación.",
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

/**
 * Turns whatever the data layer threw into a typed failure. Only the two
 * domain error classes are recognised; anything else (Firestore down, a bug)
 * is the generic "failed" — and is not logged here, it could carry values.
 */
export function failureFromError(error: unknown): ActionFailure {
  if (error instanceof InventoryError) {
    return failure(error.code);
  }
  if (error instanceof CastingInputError) {
    return failure("invalid", castingErrorMessage(error));
  }
  return failure("failed");
}
