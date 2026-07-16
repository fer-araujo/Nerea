import { useLocale } from "next-intl";
import type { Money } from "@/lib/commerce/types";
import { cn } from "@/lib/cn";

interface PriceProps {
  money: Money;
  className?: string;
}

// Map the app locale to a formatting locale. `es-MX` renders "$1,850.00";
// `en-US` renders "MX$1,850.00", which usefully disambiguates the currency for
// international viewers of a Mexican atelier.
const INTL_LOCALES: Record<string, string> = {
  es: "es-MX",
  en: "en-US",
};

// Money.amount is in centavos (minor units, integer). Prices render in mono
// with tabular figures so columns of prices align — part of the spec-plate /
// "documented artifact" language.
export function Price({ money, className }: PriceProps) {
  const locale = useLocale();
  const formatted = new Intl.NumberFormat(INTL_LOCALES[locale] ?? "es-MX", {
    style: "currency",
    currency: money.currency,
    minimumFractionDigits: 2,
  }).format(money.amount / 100);

  return (
    <span className={cn("font-mono text-sm tabular-nums text-ink", className)}>
      {formatted}
    </span>
  );
}
