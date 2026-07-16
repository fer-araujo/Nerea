import type { Metadata } from "next";
import { Fraunces, Space_Grotesk, JetBrains_Mono } from "next/font/google";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import { MotionProvider } from "@/components/motion/MotionProvider";
import "./globals.css";

export { generateStaticParams } from "@/i18n/routing";

// Display — Fraunces (optical, warm serif). Brief-mandated: the client named a
// serif for the atelier/gallery identity, so the usual "no default serif" guard
// doesn't apply here. `opsz` axis lets headings pick up optical warmth.
const fraunces = Fraunces({
  subsets: ["latin"],
  axes: ["opsz"],
  variable: "--font-fraunces",
  display: "swap",
});

// Body / UI — Space Grotesk. A clean grotesque with more architectural
// character than Inter; carries the MCM "precision" side of the synthesis.
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-grotesk",
  display: "swap",
});

// Data — JetBrains Mono. Drives the signature spec-plates and prices.
const jetBrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: "nerea",
  description: "Piezas únicas, hechas a mano",
};

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
  const messages = await getMessages();

  return (
    <html
      lang={locale}
      className={`${fraunces.variable} ${spaceGrotesk.variable} ${jetBrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <MotionProvider>{children}</MotionProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
