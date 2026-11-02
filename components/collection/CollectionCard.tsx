import type { Collection } from "@/lib/commerce/types";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { PlaceholderBlock } from "@/components/ui/PlaceholderBlock";
import { MediaFrame } from "@/components/product/MediaFrame";

interface CollectionCardProps {
  collection: Collection;
  /** Set on above-the-fold cards to prioritize their image for LCP. */
  priority?: boolean;
  /** Position within the rendered grid — cycles the no-cover placeholder tone. */
  index?: number;
  className?: string;
}

// Presentational card for the collections index. Same anatomy as ProductCard
// (image well, hairline, serif title) so the two grids read as one system; the
// cover is optional, and a collection without one falls through to the same
// PlaceholderBlock a piece without photos uses.
export function CollectionCard({
  collection,
  priority,
  index,
  className,
}: CollectionCardProps) {
  return (
    <article className={cn("group", className)}>
      <Link href={`/colecciones/${collection.slug}`} className="block">
        <div className="relative aspect-[4/5] overflow-hidden bg-bone-sunk">
          {collection.cover ? (
            <MediaFrame
              item={collection.cover}
              alt={collection.title}
              priority={priority}
              sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
              className="transition-transform duration-700 ease-out group-hover:scale-[1.03] group-focus-visible:scale-[1.03]"
            />
          ) : (
            <PlaceholderBlock className="absolute inset-0" toneIndex={index} />
          )}
        </div>

        <div className="mt-3 border-t border-line pt-2.5">
          <h2 className="font-display text-lg leading-snug text-ink">
            {collection.title}
          </h2>
          {collection.description && (
            <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-graphite">
              {collection.description}
            </p>
          )}
        </div>
      </Link>
    </article>
  );
}
