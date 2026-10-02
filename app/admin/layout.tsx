import type { Metadata } from "next";
import { fontVariables } from "../fonts";
import "../globals.css";

// Never static: every admin route depends on the request's session cookie, and
// nothing under /admin may be cached or prerendered.
export const dynamic = "force-dynamic";

// The admin panel is its own root layout, sibling to app/[locale]/ and
// app/studio/: Spanish-only, not locale-routed (middleware.ts excludes
// /admin), so it owns its <html>/<body> and does not mount the storefront's
// providers, header, footer or cart. Fonts and design tokens are shared with
// the storefront (app/fonts.ts, app/globals.css) so the panel reads as part of
// the same atelier.
export const metadata: Metadata = {
  title: { default: "Panel", template: "%s · Panel nerea" },
  robots: { index: false, follow: false },
};

export default function AdminRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" className={`${fontVariables} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
