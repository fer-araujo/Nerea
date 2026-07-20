import type { MetadataRoute } from "next";
import { routing } from "@/i18n/routing";
import { absoluteUrl } from "@/lib/seo";

// /studio (the embedded Sanity admin) is also marked noindex directly in
// its own layout via next-sanity's studio metadata (app/studio/layout.tsx
// re-exports it) — disallowing it here additionally keeps crawlers from
// requesting it at all. /[locale]/checkout is a dynamic Stripe handoff
// target plus a session-specific success page (also noindex per-page, see
// app/[locale]/checkout/success/page.tsx) — never worth crawling.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/studio",
        ...routing.locales.map((locale) => `/${locale}/checkout`),
      ],
    },
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
