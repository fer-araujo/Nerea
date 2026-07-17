import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";
import { Reveal } from "@/components/motion/Reveal";

export { generateStaticParams } from "@/i18n/routing";

// Fully static — no commerce data, no ISR window needed (design.md —
// Rendering / Data-Fetching Strategy: "/about" is SSG, copy from messages
// JSON only). Content (the `About` namespace in messages/{locale}.json) is
// assistant-drafted from the brief and is DRAFT PENDING ARTISAN REVIEW (spec:
// brand-pages — Draft Content Marking) — see openspec/changes/mvp-launch/
// tasks.md 4.12 for the tracked review note. Reuses the landing page's ethos-
// band visual pattern (recessed material band + mono spec-plate `<dl>`)
// rather than inventing a new layout, per the design system's restraint.
export default async function AboutPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = hasLocale(routing.locales, rawLocale)
    ? rawLocale
    : routing.defaultLocale;
  setRequestLocale(locale);

  const t = await getTranslations("About");

  const specs = [
    { label: t("specOriginLabel"), value: t("specOriginValue") },
    { label: t("specTechniqueLabel"), value: t("specTechniqueValue") },
    { label: t("specMaterialLabel"), value: t("specMaterialValue") },
    { label: t("specEditionLabel"), value: t("specEditionValue") },
  ];

  return (
    <main className="flex-1">
      <section className="mx-auto w-full max-w-6xl px-6 py-16 sm:px-10 sm:py-24">
        <p className="font-mono text-xs uppercase tracking-[0.14em] text-graphite">
          {t("kicker")}
        </p>
        <h1 className="mt-4 font-display text-3xl leading-tight text-ink sm:text-4xl">
          {t("title")}
        </h1>
        <p className="mt-6 max-w-prose text-base leading-relaxed text-graphite sm:text-lg">
          {t("intro")}
        </p>
      </section>

      <section className="border-t border-line bg-bone-sunk">
        <div className="mx-auto grid w-full max-w-6xl gap-12 px-6 py-20 sm:px-10 sm:py-28 lg:grid-cols-2 lg:gap-20">
          <Reveal mode="in-view">
            <h2 className="font-display text-2xl leading-tight text-ink sm:text-3xl">
              {t("processTitle")}
            </h2>
            <p className="mt-5 max-w-md text-base leading-relaxed text-graphite">
              {t("processBody")}
            </p>

            <h2 className="mt-10 font-display text-2xl leading-tight text-ink sm:text-3xl">
              {t("materialsTitle")}
            </h2>
            <p className="mt-5 max-w-md text-base leading-relaxed text-graphite">
              {t("materialsBody")}
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

      <section className="mx-auto w-full max-w-6xl px-6 py-16 sm:px-10 sm:py-20">
        <Link
          href="/shop"
          className="font-mono text-sm text-ink underline decoration-line underline-offset-4 transition-colors hover:decoration-brass"
        >
          {t("cta")}
        </Link>
      </section>
    </main>
  );
}
