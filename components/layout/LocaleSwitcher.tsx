"use client";

import { useLocale } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { cn } from "@/lib/cn";

// ES / EN toggle. `usePathname` from the next-intl navigation returns the
// pathname WITHOUT the locale prefix, so re-linking to the same pathname with a
// different `locale` swaps language while keeping the visitor on the same page
// (e.g. /es/products/x -> /en/products/x). Real <Link>s, not client-side state,
// so it works before hydration and each locale is crawlable.
export function LocaleSwitcher() {
  const pathname = usePathname();
  const active = useLocale();

  return (
    <div className="flex items-center gap-1 font-mono text-xs">
      {routing.locales.map((locale, index) => {
        const isActive = locale === active;
        return (
          <span key={locale} className="flex items-center gap-1">
            {index > 0 && (
              <span aria-hidden="true" className="text-line">
                /
              </span>
            )}
            <Link
              href={pathname}
              locale={locale}
              aria-current={isActive ? "true" : undefined}
              className={cn(
                "px-1 uppercase tracking-[0.1em] transition-colors",
                isActive
                  ? "text-ink underline decoration-brass decoration-1 underline-offset-4"
                  : "text-graphite hover:text-ink",
              )}
            >
              {locale}
            </Link>
          </span>
        );
      })}
    </div>
  );
}
