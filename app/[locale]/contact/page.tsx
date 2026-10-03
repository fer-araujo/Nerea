import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { buildPageMetadata, pageTitle } from "@/lib/seo";
import { getSiteSettings } from "@/lib/site-settings/adapter";
import { ContactForm } from "@/components/contact/ContactForm";
import { WhatsAppLink } from "@/components/ui/WhatsAppLink";

export { generateStaticParams } from "@/i18n/routing";

// Same secondary button look as the checkout success page and the cart footer.
const WHATSAPP_LINK_CLASS =
  "mt-6 inline-flex min-h-11 items-center justify-center border border-ink px-6 py-3 font-sans text-sm text-ink transition-colors duration-200 hover:bg-bone-sunk";

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
    pathname: "/contact",
    title: pageTitle(t("contact.title")),
    description: t("contact.description"),
    ogImageAlt: t("ogImageAlt"),
  });
}

// Static shell (design.md: "/contact" is SSG, no catalog data) — the one thing
// it reads is the optional WhatsApp number from the site settings, through the
// same ISR-tagged fetch the Header already makes, so the page stays statically
// rendered and refreshes with it. Only the form itself is a client island
// (ContactForm) so submit can be intercepted without a page reload/navigation.
// Submissions are stored in
// Firestore (`contactMessages`) via the submitContact Server Action
// (lib/contact/submit.ts) and read in the admin panel (/admin/mensajes) —
// see ContactForm's own comment for why a mailto fallback was rejected
// instead. Content (the `Contact` namespace) is
// assistant-drafted and DRAFT PENDING ARTISAN REVIEW (spec: brand-pages —
// Draft Content Marking) — see openspec/changes/mvp-launch/tasks.md 4.13.
export default async function ContactPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = hasLocale(routing.locales, rawLocale)
    ? rawLocale
    : routing.defaultLocale;
  setRequestLocale(locale);

  // Independent reads, so they run together. getSiteSettings never throws: a
  // Sanity blip only hides the WhatsApp link, the form always renders.
  const [t, settings] = await Promise.all([
    getTranslations("Contact"),
    getSiteSettings(locale),
  ]);

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-16 sm:px-10 sm:py-24">
      <p className="font-mono text-xs uppercase tracking-[0.14em] text-graphite">
        {t("kicker")}
      </p>
      <h1 className="mt-4 font-display text-3xl leading-tight text-ink sm:text-4xl">
        {t("title")}
      </h1>
      <p className="mt-6 max-w-prose text-base leading-relaxed text-graphite sm:text-lg">
        {t("intro")}
      </p>

      {/* Renders nothing unless the site settings hold a usable number. */}
      <WhatsAppLink
        number={settings.whatsappNumber}
        message={t("whatsappText")}
        className={WHATSAPP_LINK_CLASS}
      >
        {t("whatsappCta")}
      </WhatsAppLink>

      <div className="mt-12 max-w-xl">
        <ContactForm />
      </div>
    </main>
  );
}
