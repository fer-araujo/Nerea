import { NextStudioLayout } from "next-sanity/studio";

// Sanity's own recommended re-exports: noindex + same-origin referrer, and
// a device-width viewport tuned for the Studio's mobile behavior.
export { metadata, viewport } from "next-sanity/studio";

// The embedded Studio is a top-level route sibling to app/[locale]/ (see
// design.md — it is intentionally NOT locale-routed), so it needs its own
// <html>/<body> shell; it cannot inherit app/[locale]/layout.tsx, which is
// scoped to the [locale] segment only.
export default function StudioRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <NextStudioLayout>{children}</NextStudioLayout>
      </body>
    </html>
  );
}
