import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Logo } from "@/components/brand/Logo";
import { getSiteSettings } from "@/lib/site-settings/adapter";
import type { Locale } from "@/lib/commerce/types";
import { LocaleSwitcher } from "./LocaleSwitcher";
import { CartTrigger } from "./CartTrigger";

// Quiet brand shell header. Sticky and translucent (content scrolls under the
// blurred bone), with a single hairline underneath — no heavy bar. Height is
// capped at 64px so the chrome never eats the gallery canvas. Server Component:
// nav labels resolve at build via getTranslations with an explicit locale (SSG
// safe); only the ES/EN toggle is a client island.
export async function Header({ locale }: { locale: string }) {
  const t = await getTranslations({ locale, namespace: "Nav" });
  // Safe: this component only ever renders under app/[locale]/layout.tsx
  // with a locale already validated against routing.locales — same
  // assumption CartDrawer.tsx documents for its own useLocale() cast.
  const settings = await getSiteSettings(locale as Locale);

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bone/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6 sm:px-10">
        <Link
          href="/"
          className="text-ink transition-colors hover:text-brass-deep"
        >
          <Logo variant="lockup" className="text-xl" src={settings.logo?.url} />
        </Link>

        <nav
          aria-label="Primary"
          className="flex items-center gap-5 sm:gap-7"
        >
          <Link
            href="/shop"
            className="font-sans text-sm text-ink transition-colors hover:text-brass-deep"
          >
            {t("shop")}
          </Link>
          <CartTrigger />
          <LocaleSwitcher />
        </nav>
      </div>
    </header>
  );
}
