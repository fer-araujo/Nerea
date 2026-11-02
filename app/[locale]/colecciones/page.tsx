import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { commerce } from "@/lib/commerce";
import type { Collection, Locale } from "@/lib/commerce/types";
import { routing } from "@/i18n/routing";
import { buildPageMetadata, pageTitle } from "@/lib/seo";
import { CollectionCard } from "@/components/collection/CollectionCard";

export { generateStaticParams } from "@/i18n/routing";

// Same 60s window as the rest of the catalog: it is also what bounds how long a
// collection that just reached its closing date can still be listed.
export const revalidate = 60;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale: rawLocale } = await params;
  const locale = hasLocale(routing.locales, rawLocale)
    ? rawLocale
    : routing.defaultLocale;
  const t = await getTranslations({ locale, namespace: "Meta" });

  return buildPageMetadata({
    locale,
    pathname: "/colecciones",
    title: pageTitle(t("collections.title")),
    description: t("collections.description"),
    ogImageAlt: t("ogImageAlt"),
  });
}

async function getCollectionList(locale: Locale): Promise<Collection[]> {
  try {
    return await commerce.getCollections(locale);
  } catch {
    // A data-layer failure must never crash the route (same posture as the shop):
    // it degrades to the "no collections yet" copy.
    return [];
  }
}

export default async function CollectionsIndexPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = hasLocale(routing.locales, rawLocale)
    ? rawLocale
    : routing.defaultLocale;
  setRequestLocale(locale);

  const t = await getTranslations("Collections");
  const collections = await getCollectionList(locale);

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-16 sm:px-10 sm:py-24">
      <header className="mb-14 max-w-xl sm:mb-20">
        <h1 className="font-display text-3xl text-ink sm:text-4xl">
          {t("title")}
        </h1>
        <p className="mt-3 text-graphite">{t("intro")}</p>
      </header>

      {collections.length === 0 ? (
        <p className="max-w-md border-t border-line pt-6 font-mono text-sm leading-relaxed text-graphite">
          <span className="block text-base text-ink">{t("emptyTitle")}</span>
          <span className="mt-2 block">{t("emptyBody")}</span>
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-x-8 gap-y-16 sm:grid-cols-2 lg:grid-cols-3">
          {collections.map((collection, index) => (
            <li key={collection.slug}>
              <CollectionCard
                collection={collection}
                priority={index < 3}
                index={index}
              />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
