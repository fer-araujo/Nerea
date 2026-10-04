import Link from "next/link";
import { PERIOD_LABELS } from "@/lib/admin/copy";
import { PERIOD_KEYS, type PeriodKey } from "@/lib/admin/domain/periods";
import { cn } from "@/lib/cn";
import {
  TAB_LINK_ACTIVE_CLASS,
  TAB_LINK_CLASS,
  TAB_LINK_IDLE_CLASS,
  TAB_ROW_CLASS,
} from "./styles";

// The period tabs (este mes / mes anterior / este año), shared by Resumen,
// Ventas and Inversiones. The period lives in the URL (`?period=`, read back
// with parsePeriodKey), so a reload or a shared link keeps it. A Server
// Component: `hrefFor` is called while the page renders on the server, so a
// function prop is fine here.
//
// The hairline under the tabs belongs to the wrapper, not to the scrolling row:
// a row that scrolls clips its own children, so an underline overlapping the
// row's OWN border would be cut off and grow a vertical scrollbar. The row sits
// on the wrapper's border instead (`-mb-px`), exactly as AdminNav sits on the
// header's, so the active underline replaces the hairline without overflowing
// anything. `className` (the page's top margin) goes on the wrapper.
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
    <div className={cn("border-b border-line", className)}>
      <nav aria-label="Periodo" className={cn("-mb-px", TAB_ROW_CLASS)}>
        {PERIOD_KEYS.map((key) => (
          <Link
            key={key}
            href={hrefFor(key)}
            aria-current={key === current ? "page" : undefined}
            className={cn(
              TAB_LINK_CLASS,
              key === current ? TAB_LINK_ACTIVE_CLASS : TAB_LINK_IDLE_CLASS,
            )}
          >
            {PERIOD_LABELS[key]}
          </Link>
        ))}
      </nav>
    </div>
  );
}
