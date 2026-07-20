import type { ProductSummary } from "@/lib/commerce/types";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { Price } from "@/components/ui/Price";
import { PlaceholderBlock } from "@/components/ui/PlaceholderBlock";
import { MediaFrame } from "@/components/product/MediaFrame";
import { AvailabilityBadge } from "@/components/product/AvailabilityBadge";

interface ProductCardProps {
  product: ProductSummary;
  /** Set on above-the-fold cards to prioritize their image for LCP. */
  priority?: boolean;
  /** Position within the rendered grid — cycles the no-photo placeholder tone. */
  index?: number;
  className?: string;
}

// Presentational catalog card. Layout is the MCM synthesis: a tall image well,
// then the mono spec-plate as a strong horizontal datum under a hairline, then
// the piece name (Fraunces) paired with its price (mono). Purely prop-driven —
// pages fetch and pass the view model. Stays a Server Component: MediaFrame
// (the only piece that needs the reduced-motion hook, for video covers) is
// its own "use client" leaf, so this card never pays a hydration cost of its
// own.
export function ProductCard({ product, priority, index, className }: ProductCardProps) {
  const isSold = product.availability === "sold";

  return (
    <article className={cn("group", className)}>
      <Link href={`/products/${product.handle}`} className="block">
        <div className="relative aspect-[4/5] overflow-hidden bg-bone-sunk">
          {product.cover ? (
            <MediaFrame
              item={product.cover}
              alt={product.title}
              priority={priority}
              sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
              className={cn(
                "transition-transform duration-700 ease-out",
                "group-hover:scale-[1.03] group-focus-visible:scale-[1.03]",
                isSold && "opacity-80 grayscale-[0.2]",
              )}
            />
          ) : (
            <PlaceholderBlock className="absolute inset-0" toneIndex={index} />
          )}
        </div>

        <div className="mt-3 border-t border-line pt-2.5">
          <AvailabilityBadge availability={product.availability} />
        </div>

        <div className="mt-2 flex items-baseline justify-between gap-3">
          <h3 className="font-display text-lg leading-snug text-ink">
            {product.title}
          </h3>
          <Price
            money={product.price}
            className={cn(
              "shrink-0",
              isSold && "text-graphite line-through decoration-graphite/40",
            )}
          />
        </div>
      </Link>
    </article>
  );
}
