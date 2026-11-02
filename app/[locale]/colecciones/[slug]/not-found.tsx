import { getTranslations } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";

// Pinned to the default locale for the same reason as the product 404 (see
// app/[locale]/products/[handle]/not-found.tsx): `not-found.tsx` gets no route
// params, and reading the locale from `headers()` would silently make the whole
// route dynamic. This covers an unknown slug AND a collection that is hidden
// (switched off or past its closing date) — the data layer treats both as
// "not found".
export default async function CollectionNotFound() {
  const t = await getTranslations({
    locale: routing.defaultLocale,
    namespace: "Collections",
  });

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-start justify-center gap-4 px-6 py-24">
      <p className="font-mono text-xs uppercase tracking-[0.14em] text-graphite">
        404
      </p>
      <h1 className="font-display text-3xl text-ink">{t("notFoundTitle")}</h1>
      <p className="text-graphite">{t("notFoundBody")}</p>
      <Link
        href="/colecciones"
        className="mt-2 font-mono text-sm text-ink underline decoration-line underline-offset-4 transition-colors hover:decoration-brass"
      >
        {t("notFoundCta")}
      </Link>
    </main>
  );
}
