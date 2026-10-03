"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

// Only pages that exist are linked — new modules add their entry here when
// their route ships, never before. `exact` keeps "Resumen" (/admin) from
// matching every nested route.
const NAV_ITEMS = [
  { href: "/admin", label: "Resumen", exact: true },
  { href: "/admin/calculadora", label: "Calculadora", exact: false },
  { href: "/admin/inventario", label: "Inventario", exact: false },
  { href: "/admin/inversiones", label: "Inversiones", exact: false },
  { href: "/admin/mensajes", label: "Mensajes", exact: false },
] as const;

// Route-based tabs: the active state comes from the URL, so it survives a
// reload and deep links. A client island only because it reads the pathname;
// the strip scrolls horizontally instead of wrapping so it stays one tidy
// line down to 360px as modules are added.
export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Secciones del panel"
      className="-mb-px flex gap-6 overflow-x-auto"
    >
      {NAV_ITEMS.map((item) => {
        const active = item.exact
          ? pathname === item.href
          : pathname === item.href || pathname.startsWith(`${item.href}/`);

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex min-h-11 shrink-0 items-center border-b-2 font-sans text-sm transition-colors",
              active
                ? "border-brass text-ink"
                : "border-transparent text-graphite hover:text-ink",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
