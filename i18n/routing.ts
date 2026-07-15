import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["es", "en"],
  defaultLocale: "es",
});

// Shared `generateStaticParams` for every `app/[locale]/**` route — every
// route added across Days 2-5 needs the same `{ locale }[]` shape, so it
// lives here once instead of being copy-pasted per route file.
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}
