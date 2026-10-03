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
  // `pieces/{handle}`: the cost side of a catalog piece, keyed by its Sanity
  // slug so the webhook and the pages can address it without a lookup.
  pieces: "pieces",
  sales: "sales",
  auditLog: "auditLog",
} as const;

// Auto-generated Firestore ids are 20 alphanumerics; this allows any sane
// custom id too. Crucially it excludes "/" — `doc("a/b/c")` would otherwise
// address a document in an arbitrary nested path.
export const DOCUMENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export function isDocumentId(value: unknown): value is string {
  return typeof value === "string" && DOCUMENT_ID_PATTERN.test(value);
}

// Firestore reserves every id that starts AND ends with two underscores
// (`__name__`) and rejects it with an error. A piece document is keyed by a
// catalog slug, which never looks like that, but this is the one place that
// decides whether a handle may become an id, so the case is closed here.
const RESERVED_ID_PATTERN = /^__.*__$/;

/** A catalog handle that can safely be used as a `pieces/{handle}` id. */
export function isPieceHandle(value: unknown): value is string {
  return isDocumentId(value) && !RESERVED_ID_PATTERN.test(value);
}

/**
 * Whether a write failed because the document it `create`s is already there
 * (gRPC code 6). The Admin SDK reports it as `code: 6` with a message that
 * starts "6 ALREADY_EXISTS"; both are checked so a change in either shape
 * doesn't turn a harmless duplicate into a failure.
 */
export function isAlreadyExistsError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const { code, message } = error as { code?: unknown; message?: unknown };
  return (
    code === 6 ||
    code === "already-exists" ||
    (typeof message === "string" && message.includes("ALREADY_EXISTS"))
  );
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
