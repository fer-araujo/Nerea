import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { commerce } from "@/lib/commerce";
import type { Locale, MediaItem, ProductSummary } from "@/lib/commerce/types";
import { getSiteSettings } from "@/lib/site-settings/adapter";
import { routing } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";
import { buildPageMetadata } from "@/lib/seo";
import { Logo } from "@/components/brand/Logo";
import { ProductCard } from "@/components/product/ProductCard";
import { MediaFrame } from "@/components/product/MediaFrame";
import { Reveal, Stagger, StaggerItem } from "@/components/motion/Reveal";
import { ScrollScene } from "@/components/motion/ScrollScene";

export { generateStaticParams } from "@/i18n/routing";

// Fallback hero backdrop, used until the artisan uploads a real photo/video
// via Studio's "Ajustes del sitio" singleton (siteSettings.heroMedia) —
// getSiteSettings degrades to `hero: null` whenever that field is empty, so
// this constant is the true zero-state default, not a placeholder pending
// deletion. `MediaFrame` renders either kind identically (object-cover,
// reduced-motion-gated autoplay for video), so no layout change is needed
// once a real asset is uploaded. `alt: ""` because the backdrop is
// decorative by default — see the `heroIsDecorative` toggle below.
const FALLBACK_HERO_MEDIA: MediaItem = {
  kind: "image",
  url: "/placeholder-hero.svg",
  alt: "",
};

// Landing is statically generated; featured pieces refresh on the same 60s ISR
// window as the catalog (design.md — Rendering / Data-Fetching Strategy).
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
    pathname: "",
    title: t("home.title"),
    description: t("home.description"),
    ogImageAlt: t("ogImageAlt"),
  });
}

async function getFeatured(locale: Locale): Promise<ProductSummary[]> {
  try {
    const products = await commerce.getProducts(locale);
    // A short, curated cut for the gallery teaser. The shop is the full index.
    return products.slice(0, 3);
  } catch {
    // A data-layer failure must never break the brand's first impression:
    // the hero and ethos carry the page on their own, and the featured grid
    // simply doesn't render (mirrors the shop route's fail-safe).
    return [];
  }
}

export default async function LandingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = hasLocale(routing.locales, rawLocale)
    ? rawLocale
    : routing.defaultLocale;
  setRequestLocale(locale);

  // `Home` (hero/featured/ethos copy) is assistant-drafted from the brief,
  // same as `About`/`Contact` — DRAFT PENDING ARTISAN REVIEW (task 5.5
  // content checklist; spec: brand-pages — Draft Content Marking applies to
  // brand-voice copy generally, not only the About/Contact pages).
  const t = await getTranslations("Home");
  const [featured, settings] = await Promise.all([
    getFeatured(locale),
    getSiteSettings(locale),
  ]);

  const heroMedia: MediaItem = settings.hero
    ? {
        kind: settings.hero.kind,
        url: settings.hero.url,
        alt: settings.heroAlt ?? undefined,
      }
    : FALLBACK_HERO_MEDIA;
  // A real `heroAlt` means the artisan authored an accessible description —
  // surface it for real and take the backdrop out of aria-hidden. With no
  // authored description (including the default fallback), the backdrop
  // stays fully decorative: the headline/body copy already carries the
  // meaningful content in text form.
  const heroIsDecorative = !heroMedia.alt;

  const specs = [
    { label: t("specMaterialLabel"), value: t("specMaterialValue") },
    { label: t("specTechniqueLabel"), value: t("specTechniqueValue") },
    { label: t("specEditionLabel"), value: t("specEditionValue") },
    { label: t("specAtelierLabel"), value: t("specAtelierValue") },
  ];

  return (
    <main className="flex-1">
      {/* HERO — the brand opens: the mark as a quiet gallery object beside an
          editorial statement of the one-of-one / cera-perdida ethos, over a
          full-bleed media backdrop (settings-driven: the artisan's uploaded
          photo/video when set via Studio, else FALLBACK_HERO_MEDIA — zero
          layout change either way).

          <ScrollScene> enhances THIS SAME markup with the GSAP scroll-scrubbed
          intro (task 3.4) on capable devices with motion allowed; everywhere
          else (reduced motion, low-end, no-JS) it renders untouched as the
          approved static hero. The nodes GSAP drives carry `data-hero-*` and are
          plain DOM — deliberately NOT Framer components — so GSAP and Framer
          never animate the same element. The media backdrop below is
          intentionally OUTSIDE that set: ScrollScene's selectors are
          unchanged, so it stays a static layer under the choreography rather
          than restructuring what GSAP targets. */}
      <ScrollScene>
        <section className="relative flex min-h-[calc(100dvh-4rem)] w-full flex-col justify-center overflow-hidden px-6 py-12 sm:px-10 sm:py-16">
          <div
            aria-hidden={heroIsDecorative ? true : undefined}
            className="absolute inset-0 -z-10"
          >
            <MediaFrame item={heroMedia} alt={heroMedia.alt ?? ""} sizes="100vw" priority />
            {/* Bone scrim: guarantees the text above stays legible no matter
                what asset the artisan uploads. */}
            <div className="absolute inset-0 bg-gradient-to-t from-bone via-bone/85 to-bone/55" />
          </div>

          <div className="mx-auto grid w-full max-w-6xl items-center gap-10 lg:grid-cols-[1.3fr_1fr] lg:gap-16">
            <div className="order-2 flex flex-col items-start lg:order-1">
              <h1
                data-hero-lede
                className="font-display text-[clamp(2.5rem,8vw,4.5rem)] leading-[1.03] tracking-tight text-ink"
              >
                {t("heroHeadline")}
              </h1>
              <p
                data-hero-body
                className="mt-6 max-w-md text-base leading-relaxed text-graphite sm:text-lg"
              >
                {t("heroBody")}
              </p>
              <div data-hero-cta className="mt-9">
                <Link
                  href="/shop"
                  className="inline-flex w-fit items-center justify-center border border-ink bg-ink px-7 py-3.5 font-sans text-sm text-bone transition-colors duration-200 hover:border-brass-deep hover:bg-brass-deep"
                >
                  {t("heroCta")}
                </Link>
              </div>
            </div>

            <div
              data-hero-mark
              className="order-1 flex justify-center lg:order-2 lg:justify-end"
            >
              <span aria-hidden="true" className="text-ink/80">
                <Logo variant="mark" className="h-28 w-auto sm:h-44 lg:h-60" />
              </span>
            </div>
          </div>
        </section>
      </ScrollScene>

      {/* FEATURED — a curated cut of the catalog, reusing the catalog card and
          the same commerce data layer. Staggered reveal on scroll. */}
      {featured.length > 0 ? (
        <section className="mx-auto w-full max-w-6xl px-6 py-20 sm:px-10 sm:py-28">
          <header className="mb-12 flex flex-col gap-4 sm:mb-16 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="font-display text-3xl text-ink sm:text-4xl">
                {t("featuredTitle")}
              </h2>
              <p className="mt-3 text-graphite">{t("featuredIntro")}</p>
            </div>
            <Link
              href="/shop"
              className="w-fit font-sans text-sm text-ink underline decoration-line underline-offset-4 transition-colors hover:decoration-brass-deep"
            >
              {t("heroCta")}
            </Link>
          </header>

          <Stagger
            as="ul"
            className="grid grid-cols-1 gap-x-8 gap-y-16 sm:grid-cols-2 lg:grid-cols-3"
          >
            {featured.map((product, index) => (
              <StaggerItem as="li" key={product.handle}>
                <ProductCard product={product} index={index} />
              </StaggerItem>
            ))}
          </Stagger>
        </section>
      ) : null}

      {/* ETHOS — a recessed material band. Statement left; the signature mono
          spec-plate right, here as a brand-level certificate of the atelier's
          real facts (material, technique, edition, place). */}
      <section className="border-t border-line bg-bone-sunk">
        <div className="mx-auto grid w-full max-w-6xl gap-12 px-6 py-20 sm:px-10 sm:py-28 lg:grid-cols-2 lg:gap-20">
          <Reveal mode="in-view">
            <h2 className="font-display text-3xl leading-tight text-ink sm:text-4xl">
              {t("ethosTitle")}
            </h2>
            <p className="mt-6 max-w-md text-base leading-relaxed text-graphite sm:text-lg">
              {t("ethosBody")}
            </p>
          </Reveal>

          <Reveal mode="in-view" delay={0.1} className="lg:justify-self-end">
            <dl className="w-full max-w-sm font-mono text-sm">
              {specs.map((spec) => (
                <div
                  key={spec.label}
                  className="flex flex-col gap-1 border-t border-line py-4 sm:flex-row sm:justify-between sm:gap-6"
                >
                  <dt className="text-graphite">{spec.label}</dt>
                  <dd className="text-ink sm:text-right">{spec.value}</dd>
                </div>
              ))}
            </dl>
          </Reveal>
        </div>
      </section>
    </main>
  );
}
