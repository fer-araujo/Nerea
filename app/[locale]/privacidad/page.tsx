import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { buildPageMetadata, pageTitle } from "@/lib/seo";
import { LegalPage } from "@/components/legal/LegalPage";

export { generateStaticParams } from "@/i18n/routing";

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
    pathname: "/privacidad",
    title: pageTitle(t("privacy.title")),
    description: t("privacy.description"),
    ogImageAlt: t("ogImageAlt"),
  });
}

// Aviso de privacidad. The route segment stays Spanish in both locales (like
// every other pathname here: the router has no localized pathnames), while the
// copy itself comes from the `Legal` messages — see lib/legal/content.ts.
export default async function PrivacyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = hasLocale(routing.locales, rawLocale)
    ? rawLocale
    : routing.defaultLocale;
  setRequestLocale(locale);

  return <LegalPage locale={locale} docKey="privacy" />;
}
