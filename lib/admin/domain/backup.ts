// The rules of the backup file, as pure functions: what a Firestore document
// becomes when it is written out as JSON, and what the download is called. The
// Firestore layer (lib/admin/data/backup.ts) reads the documents and calls
// these; nothing here does I/O.

import { mexicoTodayIso } from "./periods";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

/** `nerea-respaldo-2026-10-03.json`, dated in Mexico City, not in UTC. */
export function backupFilename(now: Date = new Date()): string {
  return `nerea-respaldo-${mexicoTodayIso(now)}.json`;
}

// A Firestore Timestamp (or a Date) as an ISO string. Timestamps are
// duck-typed — anything with a `toDate()` — like `toDate` in data/shared.ts.
// `undefined` = not a timestamp at all; `null` = one whose date is unusable.
function isoOf(value: object): string | null | undefined {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if ("toDate" in value && typeof value.toDate === "function") {
    const date: unknown = value.toDate();
    return date instanceof Date && !Number.isNaN(date.getTime())
      ? date.toISOString()
      : null;
  }
  return undefined;
}

function constructorName(value: object): string {
  const { constructor } = value as { constructor?: unknown };
  return typeof constructor === "function" && constructor.name
    ? constructor.name
    : "object";
}

/**
 * A Firestore value as plain JSON. Timestamps and dates become ISO strings;
 * `undefined` keys are dropped (and an `undefined` in an array is `null`); a
 * non-finite number is `null` and a bigint a string, because JSON can hold
 * neither.
 *
 * Only PLAIN data is ever walked. Any other object — a DocumentReference, a
 * GeoPoint, bytes — is replaced by a short marker instead of being
 * serialized: a DocumentReference points back at the Firestore client, and
 * walking that would put the client's settings into the backup. The app never
 * writes such a field, but a document can be edited by hand in the Firebase
 * console, and a backup must never be the way a credential leaves the server.
 */
export function toJsonValue(value: unknown): JsonValue | undefined {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map((item) => toJsonValue(item) ?? null);
  }
  if (typeof value !== "object") {
    // undefined, a function or a symbol: nothing JSON can hold.
    return undefined;
  }

  const iso = isoOf(value);
  if (iso !== undefined) {
    return iso;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return `[unsupported: ${constructorName(value)}]`;
  }

  // fromEntries defines own properties, so no key can reach a prototype.
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, inner]) => {
      const converted = toJsonValue(inner);
      return converted === undefined ? [] : [[key, converted] as const];
    }),
  );
}

/** A document's data as a JSON object (`{}` if it is somehow not an object). */
export function toJsonObject(data: unknown): JsonObject {
  const converted = toJsonValue(data);
  return typeof converted === "object" &&
    converted !== null &&
    !Array.isArray(converted)
    ? converted
    : {};
}
