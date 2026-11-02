import Link from "next/link";
import { cn } from "@/lib/cn";
import {
  TAB_LINK_ACTIVE_CLASS,
  TAB_LINK_CLASS,
  TAB_LINK_IDLE_CLASS,
  TAB_ROW_CLASS,
} from "./styles";

export interface ViewTab<K extends string> {
  key: K;
  label: string;
  href: string;
}

// The tabs of a page with several views (Inventario: Materiales / Compras).
// The view lives in the URL (`?vista=`), so a reload or a shared link keeps it.
// Same strip and same hairline-under-the-row arrangement as PeriodNav (see the
// note there on why the hairline belongs to the wrapper), so the two rows look
// and scroll alike; `className` (the page's top margin) goes on the wrapper.
export function ViewTabs<K extends string>({
  label,
  tabs,
  current,
  className,
}: {
  label: string;
  tabs: ReadonlyArray<ViewTab<K>>;
  current: K;
  className?: string;
}) {
  return (
    <div className={cn("border-b border-line", className)}>
      <nav aria-label={label} className={cn("-mb-px", TAB_ROW_CLASS)}>
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={tab.key === current ? "page" : undefined}
            className={cn(
              TAB_LINK_CLASS,
              tab.key === current ? TAB_LINK_ACTIVE_CLASS : TAB_LINK_IDLE_CLASS,
            )}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
