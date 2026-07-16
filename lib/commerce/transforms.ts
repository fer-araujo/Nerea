import type { Availability, Locale, Money } from "./types";

// Single derivation point for `Availability`. Fail-safe by design: anything
// other than the literal source status "available" resolves to "sold" —
// missing/unknown/malformed status must never throw, and must never be
// read as buyable when we're unsure. Implying a piece is available when we
// don't actually know risks selling something we no longer have; the
// reverse mistake (hiding an available piece) is merely a lost sale.
export function toAvailability(status: unknown): Availability {
  return status === "available" ? "available" : "sold";
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
