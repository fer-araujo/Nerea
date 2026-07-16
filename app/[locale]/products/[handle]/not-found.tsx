import { getTranslations } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";

// `not-found.tsx` receives no route params, so the active locale can't be
// read the normal way. Calling `getTranslations()` with no explicit locale
// falls back to reading it from `headers()`, a dynamic API — that silently
// disqualifies this whole route from static generation (confirmed via
// `next build -d`: "Static generation failed due to dynamic usage on
// /es/products/..., reason: headers", which disappeared once this used an
// explicit locale instead). Pinning to the default locale keeps the known
// SSG'd product pages static; the tradeoff is this one boundary always
// renders in Spanish, even under /en. Acceptable for a 404 (spec only
// requires returning a 404 page, not bilingual 404 copy) — revisit if the
// artisan wants a true per-locale 404.
export default async function ProductNotFound() {
  const t = await getTranslations({
    locale: routing.defaultLocale,
    namespace: "ProductDetail",
  });

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-start justify-center gap-4 px-6 py-24">
      <p className="font-mono text-xs uppercase tracking-[0.14em] text-graphite">
        404
      </p>
      <h1 className="font-display text-3xl text-ink">{t("notFoundTitle")}</h1>
      <p className="text-graphite">{t("notFoundBody")}</p>
      <Link
        href="/shop"
        className="mt-2 font-mono text-sm text-ink underline decoration-line underline-offset-4 transition-colors hover:decoration-brass"
      >
        {t("notFoundCta")}
      </Link>
    </main>
  );
}
