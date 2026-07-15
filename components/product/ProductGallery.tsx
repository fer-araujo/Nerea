"use client";

import { useState } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { PlaceholderBlock } from "@/components/ui/PlaceholderBlock";
import { cn } from "@/lib/cn";

interface ProductGalleryProps {
  images: string[];
  /** Localized product title, reused as the main image alt text. */
  alt: string;
  className?: string;
}

// Product-detail gallery. Client-side only because selecting a thumbnail is
// local interaction state. Single image -> just the main frame; multiple ->
// a keyboard-operable thumbnail strip. No image -> the material placeholder.
export function ProductGallery({ images, alt, className }: ProductGalleryProps) {
  const t = useTranslations("Product");
  const gallery = images.filter(Boolean);
  const [active, setActive] = useState(0);
  const current = gallery[active] ?? gallery[0];

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div className="relative aspect-[4/5] overflow-hidden bg-bone-sunk">
        {current ? (
          <Image
            key={current}
            src={current}
            alt={alt}
            fill
            priority
            sizes="(min-width: 1024px) 50vw, 100vw"
            className="object-cover"
          />
        ) : (
          <PlaceholderBlock className="absolute inset-0" />
        )}
      </div>

      {gallery.length > 1 && (
        <ul className="flex flex-wrap gap-3" role="list">
          {gallery.map((image, index) => {
            const isActive = index === active;
            return (
              <li key={image}>
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
                  <Image
                    src={image}
                    alt=""
                    fill
                    sizes="64px"
                    className="object-cover"
                  />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
