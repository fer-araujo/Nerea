"use client";

import Image from "next/image";
import type { MediaItem } from "@/lib/commerce/types";
import { usePrefersReducedMotion } from "@/components/motion/MotionProvider";
import { cn } from "@/lib/cn";

interface MediaFrameProps {
  item: MediaItem;
  /** Alt text fallback (e.g. the product title) when `item.alt` isn't set. */
  alt: string;
  sizes: string;
  priority?: boolean;
  className?: string;
}

// THE one place that decides how a single MediaItem renders — shared by
// ProductCard (catalog cover), ProductGallery (product-detail main frame),
// and the landing hero backdrop, so the image/video decision and the
// reduced-motion gate never drift between call sites. Always fills its
// nearest positioned ancestor (mirrors next/image's `fill` behavior for the
// video branch too) — callers just wrap it in a `relative` box.
export function MediaFrame({ item, alt, sizes, priority, className }: MediaFrameProps) {
  const prefersReducedMotion = usePrefersReducedMotion();

  if (item.kind === "image") {
    const isSvg = item.url.toLowerCase().endsWith(".svg");
    if (isSvg) {
      // next/image's optimizer rejects SVG unless `images.dangerouslyAllowSVG`
      // is enabled in next.config.ts — a flag this project deliberately does
      // not set (see components/ui/PlaceholderBlock.tsx's own "no
      // next/image SVG-optimization opt-in" precedent). A plain <img>
      // sidesteps the optimizer entirely. This branch is safe regardless of
      // the source (local placeholder asset in public/, or an artisan's
      // Sanity Studio upload via siteSettings.heroMedia — see
      // lib/site-settings): an <img src> cannot execute a <script> embedded
      // in an SVG file the way an inline <svg>/dangerouslySetInnerHTML
      // render can, so this is not an XSS vector even for untrusted SVG.
      return (
        // eslint-disable-next-line @next/next/no-img-element -- local placeholder SVG only, see comment above
        <img
          src={item.url}
          alt={item.alt ?? alt}
          className={cn("absolute inset-0 h-full w-full object-cover", className)}
        />
      );
    }

    return (
      <Image
        src={item.url}
        alt={item.alt ?? alt}
        fill
        sizes={sizes}
        priority={priority}
        className={cn("object-cover", className)}
      />
    );
  }

  // Video/GIF gallery item. Autoplays muted/looped/inline by default;
  // reduced-motion visitors get native controls and no autoplay instead —
  // a user-initiated alternative, not the media simply hidden.
  return (
    <video
      src={item.url}
      preload="metadata"
      aria-label={item.alt ?? alt}
      className={cn("absolute inset-0 h-full w-full object-cover", className)}
      {...(prefersReducedMotion
        ? { controls: true }
        : { autoPlay: true, muted: true, loop: true, playsInline: true })}
    />
  );
}
