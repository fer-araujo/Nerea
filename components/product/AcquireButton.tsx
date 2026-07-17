"use client";

import type { ProductSummary } from "@/lib/commerce/types";
import { useCart } from "@/lib/cart/cart-context";
import { cn } from "@/lib/cn";

interface AcquireButtonProps {
  label: string;
  product: Pick<ProductSummary, "handle" | "title" | "price" | "image">;
  className?: string;
}

// Adds the piece to the cart (CartProvider.addItem also opens the drawer —
// that IS the "added" feedback, per spec: "Adding a product updates the
// drawer"). Never rendered for a sold piece; the product detail page already
// gates that above this component (see app/[locale]/products/[handle]/
// page.tsx), so there is no availability check here — this button's sole
// job is the add-to-cart action.
export function AcquireButton({
  label,
  product,
  className,
}: AcquireButtonProps) {
  const { addItem } = useCart();

  return (
    <button
      type="button"
      onClick={() => addItem(product)}
      className={cn(
        "inline-flex w-fit items-center justify-center border border-ink bg-ink px-6 py-3 font-sans text-sm text-bone transition-colors duration-200 hover:border-brass-deep hover:bg-brass-deep",
        className,
      )}
    >
      {label}
    </button>
  );
}
