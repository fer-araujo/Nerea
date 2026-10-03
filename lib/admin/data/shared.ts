import "server-only";

// Pieces shared by the inventory data modules (materials, purchases,
// castings, auditLog). Server-only, like everything under lib/admin/data.

export const COLLECTIONS = {
  materials: "materials",
  // A SUBCOLLECTION of materials/{id}: lets a material's history be read with a
  // single-field orderBy, with no composite index.
  movements: "movements",
  purchases: "purchases",
  castings: "castings",
  auditLog: "auditLog",
} as const;

// Auto-generated Firestore ids are 20 alphanumerics; this allows any sane
// custom id too. Crucially it excludes "/" — `doc("a/b/c")` would otherwise
// address a document in an arbitrary nested path.
export const DOCUMENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export function isDocumentId(value: unknown): value is string {
  return typeof value === "string" && DOCUMENT_ID_PATTERN.test(value);
}

// Documents are only ever written by these modules, but they are also
// editable by hand in the Firebase console — so every read path coerces each
// field instead of trusting its shape.

/** A Firestore Timestamp, duck-typed so a hand-edited field degrades to null. */
export function toDate(value: unknown): Date | null {
  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof value.toDate === "function"
  ) {
    const date: unknown = value.toDate();
    return date instanceof Date ? date : null;
  }
  return null;
}

export function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function readOptionalString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

export function readNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Integer centavos, or 0 for anything that isn't a safe non-negative integer. */
export function readCentavos(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : 0;
}

/** Reads a field only when it is one of the allowed values. */
export function readEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return allowed.find((candidate) => candidate === value) ?? fallback;
}
