import type { MediaItem } from "@/lib/commerce/types";

/**
 * Site-wide branding, read from the "siteSettings" singleton document (see
 * sanity/schemaTypes/siteSettings.ts). Every field on that document is
 * optional, so every field here is nullable too — the storefront's own
 * built-in placeholders (the coded Logo mark/wordmark, the local
 * placeholder-hero.svg) are the real default; this type's all-null shape is
 * what a consumer falls back from, not a state it needs to guard against
 * separately.
 */
export interface SiteSettings {
  /** Uploaded brand logo. Always `kind: "image"` — the field only accepts images. */
  logo: MediaItem | null;
  /** Landing hero backdrop — the first (and only) `heroMedia` array item. */
  hero: MediaItem | null;
  /** Accessible description of the hero backdrop, already locale-resolved. */
  heroAlt: string | null;
}
