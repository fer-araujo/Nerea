import { ImageResponse } from "next/og";
import { OG_IMAGE_SIZE } from "@/lib/seo";

// Default brand OG/Twitter card image, shared across every route today (see
// lib/seo.ts — OG_IMAGE_PATH / buildPageMetadata). Rendered from the same
// design tokens as the rest of the site (app/[locale]/globals.css) instead
// of a hand-exported asset, because the real logo is still a PLACEHOLDER
// (components/brand/Logo.tsx — no vector file exists yet) and this route
// can't reuse it as-is (it's a React component tree meant for the DOM, not
// satori's constrained JSX-to-PNG renderer). Swap this file alone once real
// brand art lands; every page only ever references the /api/og URL, never
// this file's contents, so nothing else needs to change.
//
// Deliberately a raster PNG via ImageResponse, not a static SVG in public/:
// most link-preview crawlers (notably Twitter/X) don't render SVG for
// og:image / twitter:image, so a hand-drawn SVG would silently fail as a
// social card even though it renders fine in a browser tab.
export const contentType = "image/png";
export const size = OG_IMAGE_SIZE;
// Zero request-dependent inputs (no params, no headers/cookies), so this is
// rendered once at build and served as a cached static asset instead of
// re-running satori on every request. Next 15+ route handlers default to
// dynamic unless opted in, unlike static/SSG pages.
export const dynamic = "force-static";

const BONE = "#f5f0e8";
const INK = "#1b1815";
const GRAPHITE = "#6b6259";
const BRASS = "#a9814e";

export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: BONE,
        }}
      >
        <div
          style={{
            display: "flex",
            width: 72,
            height: 2,
            backgroundColor: BRASS,
            marginBottom: 36,
          }}
        />
        <div
          style={{
            display: "flex",
            fontFamily: "sans-serif",
            fontSize: 132,
            color: INK,
            letterSpacing: "0.01em",
          }}
        >
          nerea
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 28,
            fontFamily: "sans-serif",
            fontSize: 28,
            color: GRAPHITE,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          Piezas únicas · One-of-a-kind
        </div>
      </div>
    ),
    size,
  );
}
