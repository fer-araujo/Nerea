import { Suspense } from "react";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";
import { ClearCartOnSuccess } from "@/components/checkout/ClearCartOnSuccess";
import { WhatsAppLink } from "@/components/ui/WhatsAppLink";
import { getSiteSettings } from "@/lib/site-settings/adapter";
import { pageTitle } from "@/lib/seo";

// Same two button looks as the cart drawer's footer (CartDrawer.tsx): the
// WhatsApp chat is the primary follow-up, the contact form the quieter one.
const PRIMARY_CTA_CLASS =
  "inline-flex min-h-11 items-center justify-center border border-ink bg-ink px-6 py-3 font-sans text-sm text-bone transition-colors duration-200 hover:border-brass-deep hover:bg-brass-deep";
const SECONDARY_CTA_CLASS =
  "inline-flex min-h-11 items-center justify-center border border-ink px-6 py-3 font-sans text-sm text-ink transition-colors duration-200 hover:bg-bone-sunk";

// Session-specific post-payment confirmation — never worth indexing, and
// there's nothing generic to show a crawler anyway (task 5.1: keep
// /checkout out of indexing, alongside /studio). robots.ts also disallows
// crawling the whole /[locale]/checkout subtree; this is the belt-and-
// suspenders per-page noindex directive for anyone who lands here from a
// shared link instead of a crawl.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale: rawLocale } = await params;
  const locale = hasLocale(routing.locales, rawLocale)
    ? rawLocale
    : routing.defaultLocale;
  const t = await getTranslations({ locale, namespace: "Checkout" });

  return {
    title: pageTitle(t("successTitle")),
    description: t("successBody"),
    robots: { index: false, follow: false },
  };
}

// Minimal, on-brand post-payment confirmation — the Stripe Checkout
// Session's `success_url` target (lib/cart/checkout.ts). There is no order
// data to fetch here: Stripe owns the charge/receipt, so this page only
// confirms the handoff completed, offers ways to reach the atelier (a
// WhatsApp chat when the site settings carry a number, and the contact form)
// and points back into the catalog. Unlike products/[handle]/not-found.tsx,
// this route receives real `params`, so it renders in the visitor's actual
// locale rather than pinning to the default.
export default async function CheckoutSuccessPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = hasLocale(routing.locales, rawLocale)
    ? rawLocale
    : routing.defaultLocale;
  setRequestLocale(locale);

  // `Checkout` copy (success confirmation) is assistant-drafted — DRAFT
  // PENDING ARTISAN REVIEW, same status as `About`/`Contact` (task 5.5
  // content checklist).
  //
  // Independent reads, so they run together. getSiteSettings never throws: a
  // Sanity blip only means no WhatsApp link, never a broken confirmation page.
  const [t, settings] = await Promise.all([
    getTranslations("Checkout"),
    getSiteSettings(locale),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-start justify-center gap-4 px-6 py-24">
      {/* Empties the cart when Stripe's `?session_id=` is present. It reads the
          query string on the client, so the Suspense boundary is what lets
          this page stay statically rendered. Renders nothing. */}
      <Suspense fallback={null}>
        <ClearCartOnSuccess />
      </Suspense>
      <p className="font-mono text-xs uppercase tracking-[0.14em] text-graphite">
        {t("successKicker")}
      </p>
      <h1 className="font-display text-3xl text-ink sm:text-4xl">
        {t("successTitle")}
      </h1>
      <p className="max-w-prose text-graphite">{t("successBody")}</p>
      <div className="mt-2 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
        {/* Renders nothing unless the site settings hold a usable number. */}
        <WhatsAppLink
          number={settings.whatsappNumber}
          message={t("whatsappText")}
          className={PRIMARY_CTA_CLASS}
        >
          {t("whatsappCta")}
        </WhatsAppLink>
        <Link href="/contact" className={SECONDARY_CTA_CLASS}>
          {t("messageCta")}
        </Link>
      </div>
      <Link
        href="/shop"
        className="mt-2 font-mono text-sm text-ink underline decoration-line underline-offset-4 transition-colors hover:decoration-brass"
      >
        {t("successCta")}
      </Link>
    </main>
  );
}
