import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { commerce } from "@/lib/commerce";
import { routing } from "@/i18n/routing";
import { cn } from "@/lib/cn";
import { buildPageMetadata, pageTitle, truncateDescription } from "@/lib/seo";
import { Price } from "@/components/ui/Price";
import { Badge } from "@/components/ui/Badge";
import { ProductGallery } from "@/components/product/ProductGallery";
import { AvailabilityBadge } from "@/components/product/AvailabilityBadge";
import { AcquireButton } from "@/components/product/AcquireButton";

// Nested dynamic segments, following Next's documented contract: the parent
// `[locale]` layout's generateStaticParams runs first, then this one is
// invoked once PER parent locale with that locale in `params`, and returns
// only the segment it owns (`handle`) — Next merges the two into the full
// {locale, handle} pair itself. (See app/[locale]/products/[handle]/
// not-found.tsx for the actual bug that was blocking SSG on this route —
// this shape is the idiomatic one, not the fix for that.)
export async function generateStaticParams({
  params,
}: {
  params: { locale: string };
}) {
  const locale = hasLocale(routing.locales, params.locale)
    ? params.locale
    : routing.defaultLocale;
  try {
    const products = await commerce.getProducts(locale);
    return products.map((product) => ({ handle: product.handle }));
  } catch {
    // A data-layer failure during the build must never crash static
    // generation for this route — same fail-safe posture as every other
    // commerce read call site (shop/page.tsx, page.tsx's getFeatured,
    // sitemap.ts). Zero pre-rendered handles still builds; Next's default
    // dynamicParams then serves any real handle on demand afterwards.
    return [];
  }
}

export const revalidate = 60;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; handle: string }>;
}): Promise<Metadata> {
  const { locale: rawLocale, handle } = await params;
  const locale = hasLocale(routing.locales, rawLocale)
    ? rawLocale
    : routing.defaultLocale;

  // Same defensive pattern as the page component below: an unrecognized
  // handle resolves to `null`, and a data-layer failure is treated the
  // same way — metadata generation must never crash the build/request.
  const product = await commerce
    .getProductByHandle(handle, locale)
    .catch(() => null);

  if (!product) {
    const t = await getTranslations({ locale, namespace: "ProductDetail" });
    return {
      title: pageTitle(t("notFoundTitle")),
      description: t("notFoundBody"),
      robots: { index: false, follow: false },
    };
  }

  const tMeta = await getTranslations({ locale, namespace: "Meta" });

  return buildPageMetadata({
    locale,
    pathname: `/products/${handle}`,
    title: pageTitle(product.title),
    description: truncateDescription(product.description),
    ogImageAlt: tMeta("ogImageAlt"),
  });
}

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ locale: string; handle: string }>;
}) {
  const { locale: rawLocale, handle } = await params;
  const locale = hasLocale(routing.locales, rawLocale)
    ? rawLocale
    : routing.defaultLocale;
  setRequestLocale(locale);

  // Defensive: an unrecognized handle already resolves to `null` (see
  // lib/commerce/fixtures.ts), and a data-layer failure is treated the same
  // way here — a 404 is a safe, honest response when we can't confirm the
  // piece exists, never a crashed page.
  const product = await commerce
    .getProductByHandle(handle, locale)
    .catch(() => null);

  if (!product) {
    notFound();
  }

  const t = await getTranslations("ProductDetail");
  const tProduct = await getTranslations("Product");
  const isSold = product.availability === "sold";

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-16 sm:px-10 sm:py-24">
      <div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
        <ProductGallery media={product.media} alt={product.title} />

        <div className="flex flex-col gap-6">
          {/* "Pieza única" is brass (craftsmanship/uniqueness), not jade —
              jade is reserved exclusively for the availability signal in
              AvailabilityBadge below, per the design system's restraint
              rule. Sold reuses the muted/graphite treatment used elsewhere
              for the gone state. */}
          <Badge variant={isSold ? "muted" : "brass"} className="w-fit">
            {isSold ? tProduct("soldOut") : tProduct("uniquePiece")}
          </Badge>

          <h1 className="font-display text-3xl leading-tight text-ink sm:text-4xl">
            {product.title}
          </h1>

          <Price
            money={product.price}
            className={cn(
              "text-base",
              isSold && "text-graphite line-through decoration-graphite/40",
            )}
          />

          <p className="max-w-prose leading-relaxed text-graphite">
            {product.description}
          </p>

          <AvailabilityBadge
            availability={product.availability}
            specs={product.category ? [product.category.title] : undefined}
            className="border-t border-line pt-4"
          />

          {!isSold && (
            <AcquireButton
              label={t("acquireCta")}
              product={product}
              className="mt-2"
            />
          )}
        </div>
      </div>
    </main>
  );
}
