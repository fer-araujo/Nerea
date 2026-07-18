import type { Metadata } from "next";
import { routing } from "@/i18n/routing";
import type { Locale } from "@/lib/commerce/types";

/**
 * Single source of truth for the site's public base URL. No production
 * domain is confirmed yet (see openspec/changes/mvp-launch/proposal.md —
 * "Domain name / DNS" open dependency), so this reads `NEXT_PUBLIC_SITE_URL`
 * with a localhost fallback for local dev/builds without the var set.
 * `metadataBase`, canonical URLs, OG/Twitter image URLs, and the
 * sitemap/robots routes all derive from this one function — once a
 * production domain is confirmed, only the env var needs to change.
 */
export function getSiteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  return raw && raw.length > 0 ? raw.replace(/\/+$/, "") : "http://localhost:3000";
}

export const SITE_NAME = "nerea";

/**
 * Default brand OG/Twitter card image (see app/api/og/route.tsx) — one
 * shared image for every route today, since real product photography
 * doesn't exist yet (lib/commerce/fixtures.ts). Swap that one file for a
 * designed asset later, or add per-route overrides, without touching any
 * page's metadata code.
 */
export const OG_IMAGE_PATH = "/api/og";
export const OG_IMAGE_SIZE = { width: 1200, height: 630 };

/** Joins an absolute pathname (e.g. "/es/shop") onto the site's base URL. */
export function absoluteUrl(pathname: string): string {
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${getSiteUrl()}${path}`;
}

// The storefront targets Mexico specifically (Stripe Checkout is MXN-only,
// see design.md), so the Spanish Open Graph locale is es_MX rather than the
// generic es_ES.
const OG_LOCALE: Record<Locale, string> = {
  es: "es_MX",
  en: "en_US",
};

export function ogLocale(locale: Locale): string {
  return OG_LOCALE[locale];
}

/**
 * hreflang-style alternates for a locale-neutral pathname (e.g. "/shop";
 * pass "" for the landing route). Includes "x-default" pointing at the
 * default locale, per the standard hreflang convention.
 */
export function languageAlternates(pathWithoutLocale: string): Record<string, string> {
  const languages: Record<string, string> = {};
  for (const locale of routing.locales) {
    languages[locale] = absoluteUrl(`/${locale}${pathWithoutLocale}`);
  }
  languages["x-default"] = absoluteUrl(`/${routing.defaultLocale}${pathWithoutLocale}`);
  return languages;
}

/**
 * Suffixes an inner-page title with the brand name, e.g. "Tienda · nerea".
 * The landing page's title IS the brand statement and should not go
 * through this (it would read as "nerea — ... · nerea").
 */
export function pageTitle(label: string): string {
  return `${label} · ${SITE_NAME}`;
}

/**
 * Keeps meta descriptions inside a sane length for search snippets without
 * cutting a word in half. No-op if already short enough. Used for
 * product-detail pages, whose description comes from Sanity/fixture copy
 * that isn't authored with a meta-description length budget in mind.
 */
export function truncateDescription(text: string, maxLength = 160): string {
  if (text.length <= maxLength) return text;
  const clipped = text.slice(0, maxLength);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${clipped.slice(0, lastSpace > 0 ? lastSpace : maxLength).trimEnd()}…`;
}

interface PageMetadataInput {
  locale: Locale;
  /** Locale-neutral pathname, e.g. "/shop", "/products/foo", or "" for home. */
  pathname: string;
  title: string;
  description: string;
  ogImageAlt: string;
}

/**
 * Builds a fully-formed per-route Metadata object: canonical + hreflang
 * alternates, a complete `openGraph` object, and a complete `twitter` card
 * — every field explicit at the leaf route rather than relying on Next's
 * layout/page metadata merge rules for nested objects like `openGraph`
 * (whether Next shallow-merges or replaces those objects between segments,
 * a fully-specified leaf value is correct either way).
 */
export function buildPageMetadata({
  locale,
  pathname,
  title,
  description,
  ogImageAlt,
}: PageMetadataInput): Metadata {
  const url = absoluteUrl(`/${locale}${pathname}`);
  const image = {
    url: absoluteUrl(OG_IMAGE_PATH),
    width: OG_IMAGE_SIZE.width,
    height: OG_IMAGE_SIZE.height,
    alt: ogImageAlt,
  };

  return {
    title,
    description,
    alternates: {
      canonical: url,
      languages: languageAlternates(pathname),
    },
    openGraph: {
      type: "website",
      title,
      description,
      url,
      siteName: SITE_NAME,
      locale: ogLocale(locale),
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
    },
  };
}
