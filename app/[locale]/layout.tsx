import type { Metadata } from "next";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import { getSiteUrl, ogLocale, SITE_NAME } from "@/lib/seo";
import { isStripeConfigured } from "@/lib/commerce/stripe/config";
import { omitLegalCopy } from "@/lib/legal/content";
import { getSiteSettings } from "@/lib/site-settings/adapter";
import { MotionProvider } from "@/components/motion/MotionProvider";
import { CartProvider } from "@/lib/cart/cart-context";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { CartDrawer } from "@/components/layout/CartDrawer";
import { fontVariables } from "../fonts";
import "../globals.css";

export { generateStaticParams } from "@/i18n/routing";

// Site-wide defaults only: `metadataBase` (so every relative/absolute URL
// built in per-route `generateMetadata` resolves correctly, task 5.1) and a
// bottom-of-stack fallback title/description/OG/Twitter. Every real route
// under this layout (landing, shop, product detail, about, contact) sets
// its own complete `generateMetadata` via lib/seo.ts's `buildPageMetadata`
// — this layout-level metadata rarely if ever surfaces, but Next.js
// requires *some* resolvable title, and it's the correct place for
// `metadataBase`, which every child segment's relative URLs depend on.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale: rawLocale } = await params;
  const locale = hasLocale(routing.locales, rawLocale)
    ? rawLocale
    : routing.defaultLocale;
  const t = await getTranslations({ locale, namespace: "Meta" });

  return {
    metadataBase: new URL(getSiteUrl()),
    title: t("home.title"),
    description: t("home.description"),
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      locale: ogLocale(locale),
    },
    twitter: {
      card: "summary_large_image",
    },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  setRequestLocale(locale);

  // `NextIntlClientProvider` needs an explicit `locale` (and `messages`) so
  // Client Components under it (e.g. ProductGallery) can resolve
  // translations without next-intl falling back to reading the request's
  // `headers()` to infer the locale — a dynamic API that silently disables
  // static generation/ISR for the whole route. Without this, product detail
  // pages built for task 2.17 render, but never as SSG (verified via
  // `next build -d`: "Static generation failed due to dynamic usage on
  // /es/products/... , reason: headers").
  //
  // The messages and the site settings are independent, so they load together.
  // The settings are the same ISR-tagged fetch the Header makes (request
  // memoization collapses the two calls into one), read here only for the
  // optional WhatsApp number the cart drawer offers; getSiteSettings never
  // throws, so a Sanity blip just means no WhatsApp link.
  const [allMessages, settings] = await Promise.all([
    getMessages(),
    getSiteSettings(locale),
  ]);

  // The legal pages' copy is left out: it is long, only Server Components
  // render it, and passing it here would serialize it into every page.
  const messages = omitLegalCopy(allMessages);

  return (
    <html
      lang={locale}
      className={`${fontVariables} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <MotionProvider>
            <CartProvider>
              <Header locale={locale} />
              {children}
              <Footer locale={locale} />
              {/* Only the boolean crosses to the client; the key never does.
                  The WhatsApp number is public (it ends up in the link). */}
              <CartDrawer
                paymentsEnabled={isStripeConfigured()}
                whatsappNumber={settings.whatsappNumber}
              />
            </CartProvider>
          </MotionProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
