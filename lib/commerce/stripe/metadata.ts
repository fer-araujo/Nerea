// Reading back what `createCheckoutSession` (./checkout.ts) attached to a
// Checkout Session. Kept apart from the webhook's route file because a Next.js
// route module may only export its handlers, and from checkout.ts because this
// side runs inside the verified webhook while that one talks to the Stripe API.
import { parseSerializedOptions } from "../options";
import type { SelectedOption } from "../types";

/** Stripe caps a metadata VALUE at 500 characters. */
export const METADATA_VALUE_MAX = 500;

/** One purchased line as it travels through `metadata.items`. */
export interface SessionItem {
  handle: string;
  /** A positive whole number of units. */
  quantity: number;
  /** The chosen ring size / chain length, when the piece takes one. */
  option?: SelectedOption;
}

/**
 * `metadata.handles`: the purchased pieces, comma-joined. A missing value is
 * "no pieces" (a session this storefront did not create), never an error.
 */
export function parseHandles(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((handle) => handle.trim())
    .filter(Boolean);
}

// ---- metadata.items ---------------------------------------------------------
//
// `handle*2|size=7;handle2*1|chain=45`: entries are `;`-separated, an entry is
// `handle*quantity` optionally followed by `|size=<value>` or `|chain=<cm>`.
// A handle is normally a slug, but Studio lets a slug be typed by hand, so the
// five characters the format itself uses (and `%`, the escape) are
// percent-escaped inside every token: the format parses back to exactly what
// was written, whatever the handle or the ring size says.

const RESERVED_CHARACTERS = /[%;*|=,]/g;
const ESCAPE_SEQUENCE = /%([0-9A-Fa-f]{2})/g;

function escapeToken(value: string): string {
  return value.replace(
    RESERVED_CHARACTERS,
    (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`,
  );
}

function unescapeToken(value: string): string {
  return value.replace(ESCAPE_SEQUENCE, (_match, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );
}

function isQuantity(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function serializeItem({ handle, quantity, option }: SessionItem): string {
  if (!isQuantity(quantity)) {
    throw new Error("Invalid item quantity.");
  }
  const head = `${escapeToken(handle)}*${quantity}`;
  if (!option) return head;
  return option.kind === "ringSize"
    ? `${head}|size=${escapeToken(option.value)}`
    : `${head}|chain=${escapeToken(String(option.lengthCm))}`;
}

/**
 * The value of `metadata.items` for a set of purchased lines. It is the
 * AUTHORITATIVE list the webhook sells from (`metadata.handles` stays only for
 * sessions created before quantities existed), so it is never cut: the caller
 * (`createCheckoutSession`) fails closed when the result is over
 * `METADATA_VALUE_MAX`, exactly like `handles`. Throws on an invalid quantity.
 */
export function serializeItems(items: readonly SessionItem[]): string {
  return items.map(serializeItem).join(";");
}

function parseItem(entry: string): SessionItem | null {
  const separator = entry.indexOf("|");
  const head = separator === -1 ? entry : entry.slice(0, separator);
  const tail = separator === -1 ? "" : entry.slice(separator + 1);

  const parts = head.split("*");
  if (parts.length !== 2) return null;
  const handle = unescapeToken(parts[0]);
  const quantity = Number(parts[1]);
  if (handle === "" || !/^\d+$/.test(parts[1]) || !isQuantity(quantity)) {
    return null;
  }

  const item: SessionItem = { handle, quantity };
  // The option is informational (what to size or cut): one that does not parse
  // is dropped, never the piece, so a paid line cannot be lost to it.
  const equals = tail.indexOf("=");
  if (equals !== -1) {
    const kind = tail.slice(0, equals);
    const value = unescapeToken(tail.slice(equals + 1));
    if (kind === "size" && value !== "") {
      item.option = { kind: "ringSize", value };
    } else if (kind === "chain") {
      const lengthCm = Number(value);
      if (value !== "" && Number.isFinite(lengthCm) && lengthCm > 0) {
        item.option = { kind: "chainLength", lengthCm };
      }
    }
  }
  return item;
}

/**
 * The inverse of `serializeItems`. Entries that do not parse (blank, a missing
 * or non-positive quantity) are skipped, never thrown on: this runs inside the
 * verified webhook and must not be able to fail a delivery by itself. A missing
 * value is "no items".
 */
export function parseItems(raw: string | null | undefined): SessionItem[] {
  if (!raw) return [];
  return raw.split(";").flatMap((entry) => {
    const item = parseItem(entry.trim());
    return item ? [item] : [];
  });
}

/**
 * Everything a paid Checkout Session sold, from its metadata. `items` is the
 * authority whenever the session HAS one (handle, quantity, option): then
 * `handles` is never consulted, not even to fill a gap. It is a comma list,
 * and a slug typed by hand in Studio could hold a comma, so reading it next to
 * `items` could invent pieces that were never sold. Only a session created
 * before quantities existed (no `items` at all) falls back to `handles`, one
 * unit each, with its options from `metadata.options`.
 */
export function readSessionItems(
  metadata: Record<string, string> | null | undefined,
): SessionItem[] {
  if (metadata?.items?.trim()) {
    return parseItems(metadata.items);
  }

  const legacyOptions = parseSerializedOptions(metadata?.options);
  return [...new Set(parseHandles(metadata?.handles))].map((handle) => {
    const option = legacyOptions.get(handle);
    return { handle, quantity: 1, ...(option ? { option } : {}) };
  });
}

/** Units per handle: several lines of one design (two sizes) add up. */
export function quantitiesByHandle(
  items: readonly SessionItem[],
): Map<string, number> {
  const quantities = new Map<string, number>();
  for (const { handle, quantity } of items) {
    quantities.set(handle, (quantities.get(handle) ?? 0) + quantity);
  }
  return quantities;
}
