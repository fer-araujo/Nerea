import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

// Locale-aware navigation primitives bound to the shared routing config.
// Everything that links between routes (product cards, header, locale switcher)
// imports `Link` from here so the active locale prefix is applied automatically
// instead of hand-building `/${locale}/...` hrefs at each call site.
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
