"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AnimatePresence, m } from "motion/react";
import Image from "next/image";
import { Link } from "@/i18n/navigation";
import { useCart } from "@/lib/cart/cart-context";
import { checkoutAction } from "@/lib/cart/checkout";
import { Price } from "@/components/ui/Price";
import { PlaceholderBlock } from "@/components/ui/PlaceholderBlock";
import { DURATION_BASE, EASE_OUT } from "@/components/motion/transitions";
import type { Locale, Money } from "@/lib/commerce/types";
import { cn } from "@/lib/cn";

// Slide-over cart. Opens on add (CartProvider.addItem sets isOpen), lists
// line items with a remove control, and hands off to the Stripe Checkout
// Server Action. Reduced-motion is handled globally by MotionProvider's
// `MotionConfig reducedMotion="user"` (transform animations are stripped
// automatically) — unlike Reveal.tsx, this drawer never needs to render
// without JS (it's interaction-only, mounted client-side from the first
// "add to cart" click), so it doesn't need Reveal's extra manual branch.
export function CartDrawer() {
  // `Cart` copy (empty state, errors, checkout CTA) is assistant-drafted —
  // DRAFT PENDING ARTISAN REVIEW, same status as `About`/`Contact` (task
  // 5.5 content checklist). Also consumed by CartTrigger.tsx.
  const t = useTranslations("Cart");
  // Safe: this component only ever renders under NextIntlClientProvider
  // with a locale sourced from routing.locales (layout.tsx), so the value
  // is always "es" | "en" at runtime even though useLocale()'s type is a
  // plain string.
  const locale = useLocale() as Locale;
  const { items, isOpen, close, removeItem, removeItems } = useCart();
  const [status, setStatus] = useState<"idle" | "pending">("idle");
  const [error, setError] = useState<string | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isOpen) {
      closeButtonRef.current?.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        close();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, close]);

  function handleClose() {
    setError(null);
    close();
  }

  async function handleCheckout() {
    setError(null);
    setStatus("pending");
    const result = await checkoutAction(items, locale);
    // A successful checkoutAction() never returns — it redirects. Reaching
    // this line always means one of the two error branches happened.
    if (result.reason === "sold") {
      removeItems(result.soldHandles);
      setError(t("soldNotice"));
    } else {
      setError(t("errorRetry"));
    }
    setStatus("idle");
  }

  const subtotal: Money = {
    amount: items.reduce((sum, item) => sum + item.price.amount, 0),
    currency: "MXN",
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <Fragment key="cart-drawer">
          <m.div
            className="fixed inset-0 z-50 bg-ink/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: DURATION_BASE }}
            onClick={handleClose}
            aria-hidden="true"
          />

          <m.aside
            role="dialog"
            aria-modal="true"
            aria-label={t("title")}
            className="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col border-l border-line bg-bone-raised"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: DURATION_BASE, ease: EASE_OUT }}
          >
            <div className="flex items-center justify-between border-b border-line px-6 py-5">
              <h2 className="font-display text-xl text-ink">{t("title")}</h2>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={handleClose}
                aria-label={t("close")}
                // -m-2 + size-11 keeps the glyph visually anchored to the
                // header's edge while growing the tap target to a WCAG
                // 2.5.8-safe 44px square (previously just the "x" glyph's
                // own tiny bounding box — a real mobile tap-target gap this
                // control, mounted on every page, would otherwise carry).
                className="-m-2 flex size-11 items-center justify-center font-mono text-lg text-graphite transition-colors hover:text-ink"
              >
                <span aria-hidden="true">&times;</span>
              </button>
            </div>

            {items.length === 0 ? (
              <div className="flex flex-1 flex-col items-start justify-center gap-3 px-6">
                <p className="font-display text-lg text-ink">{t("empty")}</p>
                <p className="text-sm text-graphite">{t("emptyBody")}</p>
                <Link
                  href="/shop"
                  onClick={handleClose}
                  className="mt-1 font-mono text-sm text-ink underline decoration-line underline-offset-4 transition-colors hover:decoration-brass"
                >
                  {t("browseCta")}
                </Link>
              </div>
            ) : (
              <ul className="flex-1 divide-y divide-line overflow-y-auto px-6">
                {items.map((item) => (
                  <li key={item.handle} className="flex gap-4 py-5">
                    <div className="relative size-20 shrink-0 overflow-hidden bg-bone-sunk">
                      {item.image ? (
                        <Image
                          src={item.image}
                          alt={item.title}
                          fill
                          sizes="80px"
                          className="object-cover"
                        />
                      ) : (
                        <PlaceholderBlock className="absolute inset-0" />
                      )}
                    </div>

                    <div className="flex flex-1 flex-col justify-between gap-2">
                      <h3 className="font-display text-base leading-snug text-ink">
                        {item.title}
                      </h3>
                      <div className="flex items-center justify-between gap-2">
                        <Price money={item.price} />
                        <button
                          type="button"
                          onClick={() => removeItem(item.handle)}
                          aria-label={t("removeLabel", { title: item.title })}
                          className="font-mono text-xs uppercase tracking-[0.1em] text-graphite underline decoration-line underline-offset-4 transition-colors hover:text-ink hover:decoration-brass"
                        >
                          {t("remove")}
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {items.length > 0 && (
              <div className="border-t border-line px-6 py-5">
                {error && (
                  <p
                    role="alert"
                    className="mb-4 border border-ink/25 bg-bone-sunk px-4 py-3 font-mono text-xs leading-relaxed text-ink"
                  >
                    {error}
                  </p>
                )}
                <div className="mb-4 flex items-center justify-between font-mono text-sm">
                  <span className="uppercase tracking-[0.1em] text-graphite">
                    {t("subtotal")}
                  </span>
                  <Price money={subtotal} className="text-base" />
                </div>
                <button
                  type="button"
                  onClick={handleCheckout}
                  disabled={status === "pending"}
                  className={cn(
                    "flex w-full items-center justify-center border border-ink bg-ink px-6 py-3 font-sans text-sm text-bone transition-colors duration-200",
                    "hover:border-brass-deep hover:bg-brass-deep",
                    "disabled:cursor-not-allowed disabled:opacity-60",
                  )}
                >
                  {status === "pending" ? t("checkingOut") : t("checkout")}
                </button>
              </div>
            )}
          </m.aside>
        </Fragment>
      )}
    </AnimatePresence>
  );
}
