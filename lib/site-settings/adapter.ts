import { toMediaItem, type RawMediaItem } from "@/lib/commerce/sanity/adapter";
import { sanityClient } from "@/lib/commerce/sanity/client";
import type { Locale } from "@/lib/commerce/types";
import { SITE_SETTINGS_QUERY } from "./queries";
import type { SiteSettings } from "./types";

export const SITE_SETTINGS_TAG = "site-settings";
const SITE_SETTINGS_REVALIDATE_SECONDS = 60;

interface RawSiteSettings {
  logo: RawMediaItem | null;
  hero: RawMediaItem | null;
  heroAlt: string | null;
}

const EMPTY_SITE_SETTINGS: SiteSettings = {
  logo: null,
  hero: null,
  heroAlt: null,
};

/**
 * Reads the "siteSettings" singleton.
 *
 * Called from two Server Component sites in the same request — Header
 * (layout-level, every route) and the landing page's hero — rather than one
 * component fetching and "passing down": Next's App Router `children` slot
 * is an already-rendered subtree, so a layout cannot inject extra props into
 * the routed page segment. Both calls share the same ISR-tagged fetch (same
 * query/params/`next.tags`), so Next's request memoization + Data Cache
 * collapse them into one real Sanity round trip per request/build — "fetch
 * once" holds in practice even with two call sites.
 *
 * Fails safe on ANY error (missing document, network failure, misconfigured
 * project) and returns an all-null SiteSettings — unlike lib/commerce's
 * adapters, which let each call site decide. This reader is different: it's
 * consumed from the site chrome (Header) present on every route, so a
 * Sanity blip must degrade the storefront's branding, not 500 the whole site.
 */
export async function getSiteSettings(locale: Locale): Promise<SiteSettings> {
  try {
    const raw = await sanityClient.fetch<RawSiteSettings | null>(
      SITE_SETTINGS_QUERY,
      { locale },
      {
        next: {
          revalidate: SITE_SETTINGS_REVALIDATE_SECONDS,
          tags: [SITE_SETTINGS_TAG],
        },
      },
    );

    if (!raw) {
      return EMPTY_SITE_SETTINGS;
    }

    return {
      logo: toMediaItem(raw.logo),
      hero: toMediaItem(raw.hero),
      heroAlt: raw.heroAlt ?? null,
    };
  } catch {
    return EMPTY_SITE_SETTINGS;
  }
}
