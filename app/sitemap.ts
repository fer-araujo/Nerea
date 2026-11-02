import type { MetadataRoute } from "next";
import { commerce } from "@/lib/commerce";
import type { Locale } from "@/lib/commerce/types";
import { routing } from "@/i18n/routing";
import { absoluteUrl, languageAlternates } from "@/lib/seo";

// Same 60s cadence as the rest of the catalog (design.md — Rendering /
// Data-Fetching Strategy), so a newly added or sold-out product's presence
// in the sitemap doesn't silently go stale between full rebuilds.
export const revalidate = 60;

// Locale-neutral static pathnames that exist under every locale ("" is the
// landing route itself, /[locale]). Product pathnames are appended below
// from the live catalog. /checkout/success and /studio are intentionally
// excluded — see app/robots.ts, which also disallows crawling them.
const STATIC_PATHNAMES = ["", "/shop", "/colecciones", "/about", "/contact"];

// The legal pages (privacy notice, purchase terms, shipping and returns):
// worth being findable, never a landing target, so they rank below the rest.
const LEGAL_PATHNAMES = ["/privacidad", "/terminos", "/envios"];

function toEntry(
  pathname: string,
  locale: Locale,
  priority: number,
): MetadataRoute.Sitemap[number] {
  return {
    url: absoluteUrl(`/${locale}${pathname}`),
    lastModified: new Date(),
    changeFrequency: "weekly",
    priority,
    alternates: { languages: languageAlternates(pathname) },
  };
}

// A failed read (or a backend that does not answer at all) must only cost the
// entries it would have added, never the whole sitemap.
async function listOrEmpty<T>(read: () => Promise<T[]>): Promise<T[]> {
  try {
    return await read();
  } catch {
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticEntries = routing.locales.flatMap((locale) => [
    ...STATIC_PATHNAMES.map((pathname) =>
      toEntry(pathname, locale, pathname === "" ? 1 : 0.8),
    ),
    ...LEGAL_PATHNAMES.map((pathname) => toEntry(pathname, locale, 0.3)),
  ]);

  // Handles and slugs are language-neutral (design.md's Sanity schema: "slug
  // (language-neutral)"), so one fetch each enumerates every product and
  // collection URL for both locales — no need to call per locale. Falls back to
  // just the static routes if the commerce layer is unreachable, same
  // fail-safe pattern as app/[locale]/shop/page.tsx (a sitemap build must
  // never crash on a data-layer error). `getCollections` returns visible
  // collections only, so a hidden or closed one never gets an entry.
  const [products, collections] = await Promise.all([
    listOrEmpty(() => commerce.getProducts(routing.defaultLocale)),
    listOrEmpty(() => commerce.getCollections(routing.defaultLocale)),
  ]);

  const productEntries = routing.locales.flatMap((locale) =>
    products.map((product) =>
      toEntry(`/products/${product.handle}`, locale, 0.6),
    ),
  );

  const collectionEntries = routing.locales.flatMap((locale) =>
    collections.map((collection) =>
      toEntry(`/colecciones/${collection.slug}`, locale, 0.7),
    ),
  );

  return [...staticEntries, ...collectionEntries, ...productEntries];
}
