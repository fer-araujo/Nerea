import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Logo } from "@/components/brand/Logo";

// Minimal atelier footer: the wordmark, a one-line credit, the single live
// route (shop; about/contact join on Day 4), and a quiet baseline. No version
// stamps, no atmospheric locale strip — just the mark and the maker's credit.
export async function Footer({ locale }: { locale: string }) {
  const t = await getTranslations({ locale, namespace: "Footer" });
  const nav = await getTranslations({ locale, namespace: "Nav" });
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-line bg-bone">
      <div className="mx-auto w-full max-w-6xl px-6 py-14 sm:px-10">
        <div className="flex flex-col gap-10 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-xs">
            <Logo variant="wordmark" className="text-2xl text-ink" />
            <p className="mt-4 text-sm leading-relaxed text-graphite">
              {t("tagline")}
            </p>
          </div>

          <nav
            aria-label="Footer"
            className="flex flex-col gap-3 font-sans text-sm"
          >
            <Link
              href="/shop"
              className="w-fit text-ink transition-colors hover:text-brass-deep"
            >
              {nav("shop")}
            </Link>
          </nav>
        </div>

        <div className="mt-12 flex flex-col gap-2 border-t border-line pt-6 font-mono text-xs text-graphite sm:flex-row sm:items-center sm:justify-between">
          <span>
            © {year} nerea. {t("rights")}
          </span>
          <span>{t("madeIn")}</span>
        </div>
      </div>
    </footer>
  );
}
