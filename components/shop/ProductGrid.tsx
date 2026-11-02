import type { ProductSummary } from "@/lib/commerce/types";
import { ProductCard } from "@/components/product/ProductCard";

interface ProductGridProps {
  products: ProductSummary[];
}

// The catalog grid, shared by the shop (components/shop/CategoryFilter.tsx, also
// as its server-rendered fallback) and the collection page, so a card never looks
// different depending on where the piece is listed. The first row is prioritized
// for LCP.
export function ProductGrid({ products }: ProductGridProps) {
  return (
    <ul className="grid grid-cols-1 gap-x-8 gap-y-16 sm:grid-cols-2 lg:grid-cols-3">
      {products.map((product, index) => (
        <li key={product.handle}>
          <ProductCard product={product} priority={index < 3} index={index} />
        </li>
      ))}
    </ul>
  );
}
