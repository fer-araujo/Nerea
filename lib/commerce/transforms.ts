import type { Availability, Locale, Money } from "./types";

// Single derivation point for `Availability`. Fail-safe by design: anything
// other than the literal source status "available" resolves to "sold" —
// missing/unknown/malformed status must never throw, and must never be
// read as buyable when we're unsure. Implying a piece is available when we
// don't actually know risks selling something we no longer have; the
// reverse mistake (hiding an available piece) is merely a lost sale.
//
// `stock` is the piece count (sanity/schemaTypes/product.ts): when the document
// has one, it decides — available iff there is at least one piece. A document
// that predates the field has none, and the legacy `status` decides instead.
export function toAvailability(status: unknown, stock?: unknown): Availability {
  return toStock(stock, status) > 0 ? "available" : "sold";
}

/**
 * How many pieces can be sold, as a whole number >= 0. A defined, finite
 * `stock` wins (floored, and never negative: a count below zero is "none", the
 * shape an oversold piece briefly has). Without one (every document created
 * before the field existed) the legacy `status` decides, keeping the fail-safe
 * above: only the literal "available" is one piece, everything else is none.
 */
export function toStock(stock: unknown, status: unknown): number {
  if (typeof stock === "number" && Number.isFinite(stock)) {
    return Math.max(0, Math.floor(stock));
  }
  return status === "available" ? 1 : 0;
}

// The storefront is MXN-only for the whole MVP (design.md). Sanity's
// `currency` field is a free-form Studio string (unlike `status`, it isn't
// constrained to a fixed options list), so it is never trusted directly —
// this is the single place that would need to change if a second currency
// ever shipped.
export function toMoney(raw: { amount: number; currency?: string }): Money {
  return { amount: raw.amount, currency: "MXN" };
}

export interface Localized {
  es: string;
  en?: string;
}

// Resolves a bilingual {es,en} field to a single locale string. Falls back
// to the default locale (es) when the requested locale's field is missing
// or empty, so the UI never renders a blank field — mirrors the GROQ
// `coalesce(...)` fallback used by the Sanity adapter, for adapters (like
// fixtures) that don't go through GROQ.
export function resolveLocalized(value: Localized, locale: Locale): string {
  if (locale === "es") {
    return value.es;
  }
  return value.en && value.en.length > 0 ? value.en : value.es;
}
