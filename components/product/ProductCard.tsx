import Image from "next/image";
import type { ProductSummary } from "@/lib/commerce/types";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { Price } from "@/components/ui/Price";
import { PlaceholderBlock } from "@/components/ui/PlaceholderBlock";
import { AvailabilityBadge } from "@/components/product/AvailabilityBadge";

interface ProductCardProps {
  product: ProductSummary;
  /** Set on above-the-fold cards to prioritize their image for LCP. */
  priority?: boolean;
  className?: string;
}

// Presentational catalog card. Layout is the MCM synthesis: a tall image well,
// then the mono spec-plate as a strong horizontal datum under a hairline, then
// the piece name (Fraunces) paired with its price (mono). Purely prop-driven —
// pages fetch and pass the view model.
export function ProductCard({ product, priority, className }: ProductCardProps) {
  const isSold = product.availability === "sold";

  return (
    <article className={cn("group", className)}>
      <Link href={`/products/${product.handle}`} className="block">
        <div className="relative aspect-[4/5] overflow-hidden bg-bone-sunk">
          {product.image ? (
            <Image
              src={product.image}
              alt={product.title}
              fill
              sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
              priority={priority}
              className={cn(
                "object-cover transition-transform duration-700 ease-out",
                "group-hover:scale-[1.03] group-focus-visible:scale-[1.03]",
                isSold && "opacity-80 grayscale-[0.2]",
              )}
            />
          ) : (
            <PlaceholderBlock className="absolute inset-0" />
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
