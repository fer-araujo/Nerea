"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import type {
  Category,
  CollectionRef,
  ProductSummary,
} from "@/lib/commerce/types";
import {
  ALL,
  CATEGORY_PARAM,
  COLLECTION_PARAM,
  filterProducts,
  slugFromParam,
  type ShopFilters,
} from "@/lib/commerce/filters";
import { ProductGrid } from "@/components/shop/ProductGrid";
import { cn } from "@/lib/cn";

interface CategoryFilterProps {
  products: ProductSummary[];
  categories: Category[];
  /** Visible collections only — hidden ones never reach this component. */
  collections?: CollectionRef[];
}

// Client-side, in-memory filter for the (SSG) shop grid: one row of chips for
// the category and one for the collection, combinable (a piece must match
// both). The page itself is still fully static — only the chip selection and
// the resulting re-render happen client-side, with no re-fetch per click
// (products, categories and collections are all fetched once, server-side, by
// the parent page). The selection is mirrored into the URL (`?categoria=` /
// `?coleccion=`) with `history.replaceState`, so a filtered view can be
// bookmarked or shared without turning the route dynamic. Reading the params
// through `useSearchParams` makes the page client-render this island, which is
// why the page wraps it in <Suspense> with the plain grid as its fallback. Each
// row degrades away when it has nothing to offer (zero categories / zero visible
// collections).
export function CategoryFilter({
  products,
  categories,
  collections = [],
}: CategoryFilterProps) {
  const t = useTranslations("Shop");
  const searchParams = useSearchParams();

  // Seeded from the URL once, on mount. A slug the page does not offer (a
  // collection that has since closed, a typo) is ignored — see slugFromParam.
  const [filters, setFilters] = useState<ShopFilters>(() => ({
    category: slugFromParam(
      searchParams.get(CATEGORY_PARAM),
      categories.map((category) => category.slug),
    ),
    collection: slugFromParam(
      searchParams.get(COLLECTION_PARAM),
      collections.map((collection) => collection.slug),
    ),
  }));

  const filtered = useMemo(
    () => filterProducts(products, filters),
    [products, filters],
  );

  function select(axis: keyof ShopFilters, slug: string) {
    const next = { ...filters, [axis]: slug };
    setFilters(next);
    mirrorToUrl(next);
  }

  return (
    <div>
      {(categories.length > 0 || collections.length > 0) && (
        <div className="mb-10 flex flex-col gap-5 sm:mb-14">
          <FilterGroup
            label={t("categoriesLabel")}
            allLabel={t("allCategories")}
            options={categories}
            active={filters.category}
            onSelect={(slug) => select("category", slug)}
          />
          <FilterGroup
            label={t("collectionsLabel")}
            allLabel={t("allCollections")}
            options={collections}
            active={filters.collection}
            onSelect={(slug) => select("collection", slug)}
          />
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="max-w-md border-t border-line pt-6 font-mono text-sm leading-relaxed text-graphite">
          {t("emptyFilterBody")}
        </p>
      ) : (
        <ProductGrid products={filtered} />
      )}
    </div>
  );
}

// Keeps the address bar in step with the chips. `replaceState` (not push):
// toggling a chip is a refinement of the same page, not a step the Back button
// should walk through. Next's router listens to it, so `useSearchParams` stays
// in sync. An axis left on "all" drops its param, which keeps /shop clean.
function mirrorToUrl({ category, collection }: ShopFilters) {
  const url = new URL(window.location.href);
  setOrDelete(url.searchParams, CATEGORY_PARAM, category);
  setOrDelete(url.searchParams, COLLECTION_PARAM, collection);
  window.history.replaceState(null, "", `${url.pathname}${url.search}`);
}

function setOrDelete(params: URLSearchParams, name: string, slug: string) {
  if (slug === ALL) {
    params.delete(name);
  } else {
    params.set(name, slug);
  }
}

interface FilterGroupProps {
  label: string;
  allLabel: string;
  options: { title: string; slug: string }[];
  active: string;
  onSelect: (slug: string) => void;
}

// One labeled row of chips with its own "all" chip. Renders nothing when there
// are no options, so a shop without collections looks exactly as before.
function FilterGroup({ label, allLabel, options, active, onSelect }: FilterGroupProps) {
  if (options.length === 0) return null;

  return (
    <div>
      <p
        aria-hidden="true"
        className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-graphite"
      >
        {label}
      </p>
      <ul className="flex flex-wrap gap-2" role="list" aria-label={label}>
        <li>
          <FilterChip
            label={allLabel}
            isActive={active === ALL}
            onClick={() => onSelect(ALL)}
          />
        </li>
        {options.map((option) => (
          <li key={option.slug}>
            <FilterChip
              label={option.title}
              isActive={active === option.slug}
              onClick={() => onSelect(option.slug)}
            />
          </li>
        ))}
      </ul>
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
