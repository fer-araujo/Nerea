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
      // sidesteps the optimizer entirely. Safe to special-case here: SVG
      // media only ever comes from local, developer-authored placeholder
      // assets in public/ (e.g. the hero banner), never from an untrusted
      // upload — Sanity's `media` field only accepts `image`/`file` assets,
      // and real product/hero photography is raster, not SVG.
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
