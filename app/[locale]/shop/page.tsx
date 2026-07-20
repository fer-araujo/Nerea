import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { commerce } from "@/lib/commerce";
import type { Locale, ProductSummary } from "@/lib/commerce/types";
import { routing } from "@/i18n/routing";
import { buildPageMetadata, pageTitle } from "@/lib/seo";
import { ProductCard } from "@/components/product/ProductCard";

export { generateStaticParams } from "@/i18n/routing";

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
    pathname: "/shop",
    title: pageTitle(t("shop.title")),
    description: t("shop.description"),
    ogImageAlt: t("ogImageAlt"),
  });
}

async function getCatalog(locale: Locale): Promise<ProductSummary[]> {
  try {
    return await commerce.getProducts(locale);
  } catch {
    // A data-layer failure must never crash the route or serve a broken/
    // blank page (spec: storefront-catalog — Empty and Error States).
    // Falling back to the same copy as the "zero products" case is
    // indistinguishable to the visitor and always renders something
    // intentional. Steady-state ISR failures are additionally covered by
    // Next's own behavior of continuing to serve the last successfully
    // generated page on a background revalidation error; this guards the
    // cold-start/build path, where no prior successful render exists yet.
    return [];
  }
}

export default async function ShopPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = hasLocale(routing.locales, rawLocale)
    ? rawLocale
    : routing.defaultLocale;
  setRequestLocale(locale);

  // `Shop` copy (title/intro/empty-state) is assistant-drafted — DRAFT
  // PENDING ARTISAN REVIEW, same status as `About`/`Contact` (task 5.5
  // content checklist).
  const t = await getTranslations("Shop");
  const products = await getCatalog(locale);

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-16 sm:px-10 sm:py-24">
      <header className="mb-14 max-w-xl sm:mb-20">
        <h1 className="font-display text-3xl text-ink sm:text-4xl">
          {t("title")}
        </h1>
        <p className="mt-3 text-graphite">{t("intro")}</p>
      </header>

      {products.length === 0 ? (
        <p className="max-w-md border-t border-line pt-6 font-mono text-sm leading-relaxed text-graphite">
          <span className="block text-base text-ink">{t("emptyTitle")}</span>
          <span className="mt-2 block">{t("emptyBody")}</span>
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-x-8 gap-y-16 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((product, index) => (
            <li key={product.handle}>
              <ProductCard product={product} priority={index < 3} index={index} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
