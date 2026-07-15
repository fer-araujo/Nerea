import { getTranslations, setRequestLocale } from "next-intl/server";

export { generateStaticParams } from "@/i18n/routing";

export default async function LandingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("Landing");

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-4xl font-semibold tracking-tight">{t("title")}</h1>
      <p className="text-lg text-zinc-600 dark:text-zinc-400">
        {t("tagline")}
      </p>
    </main>
  );
}
