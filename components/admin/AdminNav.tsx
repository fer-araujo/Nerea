"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import {
  TAB_LINK_ACTIVE_CLASS,
  TAB_LINK_CLASS,
  TAB_LINK_IDLE_CLASS,
  TAB_ROW_CLASS,
} from "./styles";

// Only pages that exist are linked — new modules add their entry here when
// their route ships, never before. `exact` keeps "Resumen" (/admin) from
// matching every nested route.
const NAV_ITEMS = [
  { href: "/admin", label: "Resumen", exact: true },
  { href: "/admin/calculadora", label: "Calculadora", exact: false },
  { href: "/admin/inventario", label: "Inventario", exact: false },
  { href: "/admin/inversiones", label: "Inversiones", exact: false },
  { href: "/admin/piezas", label: "Piezas", exact: false },
  { href: "/admin/ventas", label: "Ventas", exact: false },
  { href: "/admin/mensajes", label: "Mensajes", exact: false },
] as const;

// Route-based tabs: the active state comes from the URL, so it survives a
// reload and deep links. A client island only because it reads the pathname;
// the strip scrolls horizontally instead of wrapping so it stays one tidy
// line down to 360px as modules are added (see TAB_ROW_CLASS for how that
// stays free of a vertical scrollbar). `-mb-px` sits the row on the header's
// bottom border, so the active underline replaces the hairline.
export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Secciones del panel"
      className={cn("-mb-px", TAB_ROW_CLASS)}
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
              TAB_LINK_CLASS,
              active ? TAB_LINK_ACTIVE_CLASS : TAB_LINK_IDLE_CLASS,
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
