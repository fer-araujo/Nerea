import type {
  ChainLengthOption,
  Locale,
  ProductOptions,
  SelectedOption,
} from "./types";

// Pure purchase-option logic shared by the Sanity adapter, the fixtures, the
// product page's picker and `checkoutAction`. No I/O and no framework imports
// on purpose: it is bundled into the client AND run on the server, and the
// Studio schema imports the ring-size list from here too (relative imports
// only — the Studio build does not resolve the `@/` alias).

// Ring sizes 4 to 13 in half-size steps. Half steps are exactly representable
// in binary floating point, so `String(n)` yields clean "4", "4.5", "5", ...
function buildDefaultRingSizes(): string[] {
  const sizes: string[] = [];
  for (let size = 4; size <= 13; size += 0.5) {
    sizes.push(String(size));
  }
  return sizes;
}

/** Last-resort ring sizes, used when neither the piece nor the site settings define any. */
export const DEFAULT_RING_SIZES: readonly string[] = buildDefaultRingSizes();

/** Last-resort chain lengths (cm), no surcharge, same fallback role as above. */
export const DEFAULT_CHAIN_LENGTHS: readonly ChainLengthOption[] = [
  { lengthCm: 40, extra: 0 },
  { lengthCm: 45, extra: 0 },
  { lengthCm: 50, extra: 0 },
];

// Raw, CMS-shaped inputs. Every field is nullable/optional because they come
// straight from GROQ over documents the artisan may have left half-filled.
export interface RawChainLength {
  lengthCm?: number | null;
  /** Centavos, mirroring the Studio's `extraPrice` field. */
  extraPrice?: number | null;
}

export interface RawOptionDefaults {
  ringSizes?: (string | null)[] | null;
  chainLengths?: (RawChainLength | null)[] | null;
}

/**
 * A piece's `purchaseOption` value meaning "use my category's option". The
 * Studio offers it as "Según la categoría" and it is the default for new
 * pieces; a piece with NO value (every document created before the field
 * existed) is treated the same way.
 */
export const INHERIT_PURCHASE_OPTION = "inherit";

export interface RawOptionSource extends RawOptionDefaults {
  /**
   * The piece's own choice: "none", "ringSize" or "chainLength" (explicit, and
   * always wins), or "inherit"/unset to take the category's.
   */
  purchaseOption?: string | null;
  /**
   * The piece's category's own `purchaseOption` (GROQ `category->purchaseOption`):
   * what an inheriting piece falls back to. Null/undefined when the piece has
   * no category or the category has not set one.
   */
  categoryPurchaseOption?: string | null;
}

// Trims, drops blanks/non-strings and de-duplicates, then orders numerically.
// The Studio's checkbox list stores sizes in click order, which the artisan
// cannot control — a picker reading "8, 6, 7" would look broken.
function normalizeRingSizes(raw: RawOptionDefaults["ringSizes"]): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const value = item.trim();
    if (value !== "") seen.add(value);
  }
  return [...seen].sort((a, b) => {
    const numA = Number(a);
    const numB = Number(b);
    const aIsNaN = Number.isNaN(numA);
    const bIsNaN = Number.isNaN(numB);
    // Non-numeric sizes keep their relative order, after the numeric ones.
    if (aIsNaN || bIsNaN) return aIsNaN === bIsNaN ? 0 : aIsNaN ? 1 : -1;
    return numA - numB;
  });
}

// Keeps the artisan's own order (the Studio array is drag-sortable). An entry
// with an unusable length is dropped, and so is one with a PRESENT-but-invalid
// surcharge: a missing surcharge is simply 0, but silently turning a
// mistyped "-5000"/"150.5" into 0 would undercharge the piece, whereas
// dropping the entry makes the mistake visible on the storefront.
function normalizeChainLengths(
  raw: RawOptionDefaults["chainLengths"],
): ChainLengthOption[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<number>();
  const result: ChainLengthOption[] = [];
  for (const item of raw) {
    const lengthCm = item?.lengthCm;
    if (
      typeof lengthCm !== "number" ||
      !Number.isFinite(lengthCm) ||
      lengthCm <= 0 ||
      seen.has(lengthCm)
    ) {
      continue;
    }
    const extra = item?.extraPrice ?? 0;
    if (typeof extra !== "number" || !Number.isInteger(extra) || extra < 0) {
      continue;
    }
    seen.add(lengthCm);
    result.push({ lengthCm, extra });
  }
  return result;
}

function firstNonEmpty<T>(...lists: readonly (readonly T[])[]): T[] {
  const found = lists.find((list) => list.length > 0);
  return found ? [...found] : [];
}

// Which KIND of option a piece takes. The piece's own explicit choice always
// wins, "none" included. A piece that says "inherit" — or says nothing, like
// every document created before the field existed — takes its category's
// choice. Whatever is left (no category, a category with no choice, or an
// unrecognized value anywhere) falls to the `default` branch of the switch in
// resolveProductOptions: none.
function resolvePurchaseKind(
  source: RawOptionSource,
): string | null | undefined {
  const own = source.purchaseOption;
  const inherits =
    own === undefined || own === null || own === INHERIT_PURCHASE_OPTION;
  return inherits ? source.categoryPurchaseOption : own;
}

/**
 * Resolves a piece's purchase options in two independent steps.
 *
 * KIND (none / ring size / chain length): the piece's own explicit choice,
 * else — when the piece says "inherit" or says nothing — its category's, else
 * none. An unrecognized value resolves to none.
 *
 * VALUES for that kind: the piece's own list when it has one, else the
 * "Ajustes del sitio" defaults, else the code defaults — so a picker can never
 * end up empty.
 */
export function resolveProductOptions(
  source: RawOptionSource,
  defaults?: RawOptionDefaults | null,
): ProductOptions {
  switch (resolvePurchaseKind(source)) {
    case "ringSize":
      return {
        kind: "ringSize",
        values: firstNonEmpty(
          normalizeRingSizes(source.ringSizes),
          normalizeRingSizes(defaults?.ringSizes),
          DEFAULT_RING_SIZES,
        ),
      };
    case "chainLength":
      return {
        kind: "chainLength",
        values: firstNonEmpty(
          normalizeChainLengths(source.chainLengths),
          normalizeChainLengths(defaults?.chainLengths),
          DEFAULT_CHAIN_LENGTHS,
        ),
      };
    default:
      return { kind: "none" };
  }
}

export type OptionInvalidReason = "missing" | "unknown" | "unexpected";

export type OptionValidation =
  | {
      valid: true;
      /** Surcharge in centavos taken from the catalog, never from the input. */
      extra: number;
      /**
       * A clean copy rebuilt from the catalog's own values — `null` when the
       * piece takes no option. Use this, never the raw input, downstream.
       */
      option: SelectedOption | null;
    }
  | { valid: false; reason: OptionInvalidReason };

function unknownOption(): OptionValidation {
  return { valid: false, reason: "unknown" };
}

/**
 * Checks a chosen option against a piece's resolved `ProductOptions`.
 * `selected` is deliberately typed `unknown`: on the server it is whatever a
 * client sent. Reasons: `missing` (required but absent), `unexpected` (an
 * option on a piece that takes none), `unknown` (anything that is not exactly
 * one of the catalog's values, including a mismatched kind or shape).
 */
export function validateOption(
  options: ProductOptions,
  selected: unknown,
): OptionValidation {
  const provided = selected !== undefined && selected !== null;

  if (options.kind === "none") {
    return provided
      ? { valid: false, reason: "unexpected" }
      : { valid: true, extra: 0, option: null };
  }
  if (!provided) return { valid: false, reason: "missing" };
  if (typeof selected !== "object") return unknownOption();

  const candidate = selected as {
    kind?: unknown;
    value?: unknown;
    lengthCm?: unknown;
  };

  if (options.kind === "ringSize") {
    if (candidate.kind !== "ringSize" || typeof candidate.value !== "string") {
      return unknownOption();
    }
    const match = options.values.find((value) => value === candidate.value);
    return match === undefined
      ? unknownOption()
      : { valid: true, extra: 0, option: { kind: "ringSize", value: match } };
  }

  if (candidate.kind !== "chainLength" || typeof candidate.lengthCm !== "number") {
    return unknownOption();
  }
  const match = options.values.find(
    (length) => length.lengthCm === candidate.lengthCm,
  );
  // Fail closed on a malformed catalog surcharge: a negative one would DISCOUNT
  // the piece and a fractional one is not a valid Stripe amount.
  if (!match || !Number.isInteger(match.extra) || match.extra < 0) {
    return unknownOption();
  }
  return {
    valid: true,
    extra: match.extra,
    option: { kind: "chainLength", lengthCm: match.lengthCm },
  };
}

const OPTION_LABELS: Record<
  Locale,
  { ringSize: (value: string) => string; chainLength: (lengthCm: number) => string }
> = {
  es: {
    ringSize: (value) => `Talla ${value}`,
    chainLength: (lengthCm) => `Cadena ${lengthCm} cm`,
  },
  en: {
    ringSize: (value) => `Size ${value}`,
    chainLength: (lengthCm) => `${lengthCm} cm chain`,
  },
};

/**
 * Human label for a chosen option ("Talla 7", "45 cm chain"). Used where
 * next-intl is not available — the Stripe line item name is built on the
 * server. The cart drawer renders the same wording from messages/*.json
 * (`Cart.optionRingSize` / `Cart.optionChainLength`); tests/commerce-options.test.ts
 * pins the two sources together so they cannot drift apart.
 */
export function formatOptionLabel(option: SelectedOption, locale: Locale): string {
  const labels = OPTION_LABELS[locale];
  return option.kind === "ringSize"
    ? labels.ringSize(option.value)
    : labels.chainLength(option.lengthCm);
}

/**
 * Compact `handle:size=7` / `handle:chain=45` pair for the Stripe session's
 * `metadata.options`, so the jeweler (and, later, the sales webhook) can read
 * what to size or cut per piece straight from the Dashboard.
 */
export function serializeOption(handle: string, option: SelectedOption): string {
  return option.kind === "ringSize"
    ? `${handle}:size=${option.value}`
    : `${handle}:chain=${option.lengthCm}`;
}
