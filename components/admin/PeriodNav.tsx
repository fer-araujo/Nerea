import Link from "next/link";
import { PERIOD_LABELS } from "@/lib/admin/copy";
import { PERIOD_KEYS, type PeriodKey } from "@/lib/admin/domain/periods";
import { cn } from "@/lib/cn";

// The period tabs (este mes / mes anterior / este año), as on the Ventas and
// Inversiones pages. The period lives in the URL (`?period=`, read back with
// parsePeriodKey), so a reload or a shared link keeps it. A Server Component:
// `hrefFor` is called while the page renders on the server, so a function prop
// is fine here.
export function PeriodNav({
  current,
  hrefFor,
  className,
}: {
  current: PeriodKey;
  hrefFor: (period: PeriodKey) => string;
  className?: string;
}) {
  return (
    <nav
      aria-label="Periodo"
      className={cn("flex gap-6 overflow-x-auto border-b border-line", className)}
    >
      {PERIOD_KEYS.map((key) => (
        <Link
          key={key}
          href={hrefFor(key)}
          aria-current={key === current ? "page" : undefined}
          className={cn(
            "-mb-px inline-flex min-h-11 shrink-0 items-center border-b-2 font-sans text-sm transition-colors",
            key === current
              ? "border-brass text-ink"
              : "border-transparent text-graphite hover:text-ink",
          )}
        >
          {PERIOD_LABELS[key]}
        </Link>
      ))}
    </nav>
  );
}
