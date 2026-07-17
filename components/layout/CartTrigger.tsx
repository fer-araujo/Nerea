"use client";

import { useTranslations } from "next-intl";
import { useCart } from "@/lib/cart/cart-context";
import { cn } from "@/lib/cn";

// Client island inside the (Server Component) Header — mirrors
// LocaleSwitcher's pattern. Shows the current line-item count and opens the
// drawer; the drawer itself renders once, globally, from the locale layout
// (see CartDrawer.tsx / app/[locale]/layout.tsx).
export function CartTrigger({ className }: { className?: string }) {
  const t = useTranslations("Cart");
  const { items, open } = useCart();
  const count = items.length;

  return (
    <button
      type="button"
      onClick={open}
      aria-label={t("trigger", { count })}
      className={cn(
        "font-mono text-xs uppercase tracking-[0.1em] text-ink transition-colors hover:text-brass-deep",
        className,
      )}
    >
      {t("title")}
      <span aria-hidden="true" className="ml-1 text-graphite">
        ({count})
      </span>
    </button>
  );
}
