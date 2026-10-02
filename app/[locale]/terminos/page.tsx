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
    pathname: "/terminos",
    title: pageTitle(t("terms.title")),
    description: t("terms.description"),
    ogImageAlt: t("ogImageAlt"),
  });
}

// Términos de compra — same Spanish route segment in both locales; copy from
// the `Legal` messages (lib/legal/content.ts).
export default async function TermsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = hasLocale(routing.locales, rawLocale)
    ? rawLocale
    : routing.defaultLocale;
  setRequestLocale(locale);

  return <LegalPage locale={locale} docKey="terms" />;
}
