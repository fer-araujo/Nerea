"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { Category, ProductSummary } from "@/lib/commerce/types";
import { ProductCard } from "@/components/product/ProductCard";
import { cn } from "@/lib/cn";

interface CategoryFilterProps {
  products: ProductSummary[];
  categories: Category[];
}

/** Sentinel for "no category selected" — never a real Sanity slug. */
const ALL = "__all__";

// Client-side, in-memory category filter for the (SSG) shop grid. The page
// itself is still fully static — only the chip selection state and the
// resulting re-render happen client-side; there is no route/query-param
// change and no re-fetch per click (products/categories are both fetched
// once, server-side, by the parent page). Degrades to just the plain grid
// when there are no categories yet (zero-category dataset).
export function CategoryFilter({ products, categories }: CategoryFilterProps) {
  const t = useTranslations("Shop");
  const [active, setActive] = useState<string>(ALL);

  const filtered = useMemo(() => {
    if (active === ALL) return products;
    return products.filter((product) => product.categorySlug === active);
  }, [products, active]);

  return (
    <div>
      {categories.length > 0 && (
        <ul
          className="mb-10 flex flex-wrap gap-2 sm:mb-14"
          role="list"
          aria-label={t("title")}
        >
          <li>
            <FilterChip
              label={t("allCategories")}
              isActive={active === ALL}
              onClick={() => setActive(ALL)}
            />
          </li>
          {categories.map((category) => (
            <li key={category.slug}>
              <FilterChip
                label={category.title}
                isActive={active === category.slug}
                onClick={() => setActive(category.slug)}
              />
            </li>
          ))}
        </ul>
      )}

      {filtered.length === 0 ? (
        <p className="max-w-md border-t border-line pt-6 font-mono text-sm leading-relaxed text-graphite">
          {t("emptyCategoryBody")}
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-x-8 gap-y-16 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((product, index) => (
            <li key={product.handle}>
              <ProductCard product={product} priority={index < 3} index={index} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface FilterChipProps {
  label: string;
  isActive: boolean;
  onClick: () => void;
}

// On-brand mono/uppercase chip matching Badge.tsx's typographic language;
// active state is conveyed by BOTH the filled background and `aria-pressed`
// (never color alone), consistent with the rest of the design system.
function FilterChip({ label, isActive, onClick }: FilterChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isActive}
      className={cn(
        "border px-3.5 py-2 font-mono text-[11px] uppercase tracking-[0.12em] transition-colors motion-safe:duration-200",
        isActive
          ? "border-ink bg-ink text-bone"
          : "border-line text-graphite hover:border-graphite hover:text-ink",
      )}
    >
      {label}
    </button>
  );
}
