import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { commerce } from "@/lib/commerce";
import type { ProductSummary } from "@/lib/commerce/types";
import { routing } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";
import { buildPageMetadata, pageTitle, truncateDescription } from "@/lib/seo";
import { MediaFrame } from "@/components/product/MediaFrame";
import { ProductGrid } from "@/components/shop/ProductGrid";

// Nested dynamic segment, same contract as app/[locale]/products/[handle]/
// page.tsx: the parent `[locale]` generateStaticParams runs first and this one
// returns only the segment it owns. Only VISIBLE collections are pre-rendered;
// a hidden one is never listed here, and `dynamicParams` (on by default) still
// resolves its URL on demand to the notFound() below.
export async function generateStaticParams({
  params,
}: {
  params: { locale: string };
}) {
  const locale = hasLocale(routing.locales, params.locale)
    ? params.locale
    : routing.defaultLocale;
  try {
    const collections = await commerce.getCollections(locale);
    return collections.map((collection) => ({ slug: collection.slug }));
  } catch {
    // A data-layer failure during the build must never crash static generation:
    // zero pre-rendered slugs still builds and real ones render on demand.
    return [];
  }
}

// Also what bounds how long a collection that just reached its closing date can
// still be served.
export const revalidate = 60;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale: rawLocale, slug } = await params;
  const locale = hasLocale(routing.locales, rawLocale)
    ? rawLocale
    : routing.defaultLocale;

  const collection = await commerce
    .getCollectionBySlug(slug, locale)
    .catch(() => null);

  if (!collection) {
    const t = await getTranslations({ locale, namespace: "Collections" });
    return {
      title: pageTitle(t("notFoundTitle")),
      description: t("notFoundBody"),
      robots: { index: false, follow: false },
    };
  }

  const tMeta = await getTranslations({ locale, namespace: "Meta" });

  return buildPageMetadata({
    locale,
    pathname: `/colecciones/${slug}`,
    title: pageTitle(collection.title),
    description:
      truncateDescription(collection.description) ||
      tMeta("collections.description"),
    ogImageAlt: tMeta("ogImageAlt"),
  });
}

export default async function CollectionPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale: rawLocale, slug } = await params;
  const locale = hasLocale(routing.locales, rawLocale)
    ? rawLocale
    : routing.defaultLocale;
  setRequestLocale(locale);

  // The two reads are independent, so they run together. A data-layer failure
  // is treated like "not found" for the collection (a 404 is an honest answer
  // when we cannot confirm it exists) and like "no pieces" for the catalog.
  const [collection, products] = await Promise.all([
    commerce.getCollectionBySlug(slug, locale).catch(() => null),
    commerce.getProducts(locale).catch((): ProductSummary[] => []),
  ]);

  // Unknown slug AND hidden collection (switched off, past its closing date):
  // the data layer returns null for both, so neither leaks a page.
  if (!collection) {
    notFound();
  }

  const pieces = products.filter((product) =>
    product.collectionSlugs?.includes(slug),
  );
  const t = await getTranslations("Collections");

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-16 sm:px-10 sm:py-24">
      <Link
        href="/colecciones"
        className="mb-10 inline-flex items-center gap-2 font-mono text-xs uppercase tracking-[0.14em] text-graphite transition-colors hover:text-ink"
      >
        <span aria-hidden="true">←</span>
        {t("back")}
      </Link>

      <header
        className={
          collection.cover
            ? "mb-14 grid gap-8 sm:mb-20 lg:grid-cols-2 lg:items-end lg:gap-16"
            : "mb-14 sm:mb-20"
        }
      >
        <div className="max-w-xl">
          <h1 className="font-display text-3xl text-ink sm:text-4xl">
            {collection.title}
          </h1>
          {collection.description && (
            <p className="mt-3 max-w-prose leading-relaxed text-graphite">
              {collection.description}
            </p>
          )}
        </div>

        {collection.cover && (
          <div className="relative aspect-[16/10] overflow-hidden bg-bone-sunk">
            <MediaFrame
              item={collection.cover}
              alt={collection.title}
              priority
              sizes="(min-width: 1024px) 50vw, 100vw"
            />
          </div>
        )}
      </header>

      {pieces.length === 0 ? (
        <div className="max-w-md border-t border-line pt-6 font-mono text-sm leading-relaxed text-graphite">
          <p>
            <span className="block text-base text-ink">
              {t("emptyPiecesTitle")}
            </span>
            <span className="mt-2 block">{t("emptyPiecesBody")}</span>
          </p>
          <Link
            href="/shop"
            className="mt-4 inline-block text-ink underline decoration-line underline-offset-4 transition-colors hover:decoration-brass"
          >
            {t("viewShop")}
          </Link>
        </div>
      ) : (
        <ProductGrid products={pieces} />
      )}
    </main>
  );
}
