"use client";

import { useState } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import type { MediaItem } from "@/lib/commerce/types";
import { PlaceholderBlock } from "@/components/ui/PlaceholderBlock";
import { MediaFrame } from "@/components/product/MediaFrame";
import { cn } from "@/lib/cn";

interface ProductGalleryProps {
  media: MediaItem[];
  /** Localized product title, reused as the main media's alt/aria-label. */
  alt: string;
  className?: string;
}

// Product-detail gallery. Client-side only because selecting a thumbnail is
// local interaction state. Single item -> just the main frame; multiple ->
// a keyboard-operable thumbnail strip. No media -> the material placeholder.
// The placeholder stays the neutral bone-sunk tone (no toneIndex) here: this
// is a standalone, single-item view with no sibling placeholder to visually
// collide with, unlike the catalog grid (see ProductCard).
export function ProductGallery({ media, alt, className }: ProductGalleryProps) {
  const t = useTranslations("Product");
  const gallery = media.filter((item) => Boolean(item.url));
  const [active, setActive] = useState(0);
  const current = gallery[active] ?? gallery[0];

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div className="relative aspect-[4/5] overflow-hidden bg-bone-sunk">
        {current ? (
          <MediaFrame
            key={current.url}
            item={current}
            alt={alt}
            priority
            sizes="(min-width: 1024px) 50vw, 100vw"
          />
        ) : (
          <PlaceholderBlock className="absolute inset-0" />
        )}
      </div>

      {gallery.length > 1 && (
        <ul className="flex flex-wrap gap-3" role="list">
          {gallery.map((item, index) => {
            const isActive = index === active;
            return (
              <li key={item.url}>
                <button
                  type="button"
                  onClick={() => setActive(index)}
                  aria-label={t("thumbnail", { number: index + 1 })}
                  aria-pressed={isActive}
                  className={cn(
                    "relative aspect-square w-16 overflow-hidden border transition-colors motion-safe:duration-200",
                    isActive
                      ? "border-brass"
                      : "border-line hover:border-graphite",
                  )}
                >
                  {item.kind === "image" ? (
                    <Image
                      src={item.url}
                      alt=""
                      fill
                      sizes="64px"
                      className="object-cover"
                    />
                  ) : (
                    // Thumbnails never autoplay, regardless of motion
                    // preference — a strip of auto-playing clips would be
                    // visually chaotic and defeats the point of a still
                    // thumbnail. `preload="metadata"` is enough for the
                    // browser to paint the first frame as a static preview.
                    <video
                      src={item.url}
                      muted
                      playsInline
                      preload="metadata"
                      aria-hidden="true"
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
