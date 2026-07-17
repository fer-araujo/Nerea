import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";

// Minimal, on-brand post-payment confirmation — the Stripe Checkout
// Session's `success_url` target (lib/cart/checkout.ts). There is no order
// data to fetch here: Stripe owns the charge/receipt, so this page only
// confirms the handoff completed and points back into the catalog. Unlike
// products/[handle]/not-found.tsx, this route receives real `params`, so it
// renders in the visitor's actual locale rather than pinning to the default.
export default async function CheckoutSuccessPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = hasLocale(routing.locales, rawLocale)
    ? rawLocale
    : routing.defaultLocale;
  setRequestLocale(locale);

  const t = await getTranslations("Checkout");

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-start justify-center gap-4 px-6 py-24">
      <p className="font-mono text-xs uppercase tracking-[0.14em] text-graphite">
        {t("successKicker")}
      </p>
      <h1 className="font-display text-3xl text-ink sm:text-4xl">
        {t("successTitle")}
      </h1>
      <p className="max-w-prose text-graphite">{t("successBody")}</p>
      <Link
        href="/shop"
        className="mt-2 font-mono text-sm text-ink underline decoration-line underline-offset-4 transition-colors hover:decoration-brass"
      >
        {t("successCta")}
      </Link>
    </main>
  );
}
