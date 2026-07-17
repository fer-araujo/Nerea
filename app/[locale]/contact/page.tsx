import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { ContactForm } from "@/components/contact/ContactForm";

export { generateStaticParams } from "@/i18n/routing";

// Fully static shell (design.md: "/contact" is SSG, no catalog data); only
// the form itself is a client island (ContactForm) so submit can be
// intercepted without a page reload/navigation. No email/API integration in
// MVP scope (see ContactForm's own comment for why a mailto fallback was
// rejected too). Content (the `Contact` namespace) is assistant-drafted and
// DRAFT PENDING ARTISAN REVIEW (spec: brand-pages — Draft Content Marking) —
// see openspec/changes/mvp-launch/tasks.md 4.13.
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

  const t = await getTranslations("Contact");

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

      <div className="mt-12 max-w-xl">
        <ContactForm />
      </div>
    </main>
  );
}
