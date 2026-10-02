"use client";

import { useId } from "react";
import type { ProductSummary, SelectedOption } from "@/lib/commerce/types";
import { useCart } from "@/lib/cart/cart-context";
import { cn } from "@/lib/cn";

interface AcquireButtonProps {
  label: string;
  /**
   * `price` is what the cart line DISPLAYS — the caller passes the base price
   * plus the chosen option's extra (see PurchasePanel). It is display-only;
   * the real charge is re-priced server-side by `checkoutAction`.
   */
  product: Pick<ProductSummary, "handle" | "title" | "price" | "cover">;
  /** The shopper's choice, stored on the cart line; omitted for pieces without one. */
  option?: SelectedOption;
  /** True while a required option has not been chosen yet. */
  disabled?: boolean;
  /**
   * Why the button is disabled ("Choose a size to ..."). Rendered as visible
   * text and tied to the button with `aria-describedby`, so the reason is
   * available to everyone, not just to sighted pointer users.
   */
  hint?: string;
  className?: string;
}

// Adds the piece to the cart (CartProvider.addItem also opens the drawer —
// that IS the "added" feedback, per spec: "Adding a product updates the
// drawer"). Never rendered for a sold piece; the product detail page already
// gates that above this component (see app/[locale]/products/[handle]/
// page.tsx), so there is no availability check here — this button's job is
// the add-to-cart action, held back while a required option is unchosen.
export function AcquireButton({
  label,
  product,
  option,
  disabled = false,
  hint,
  className,
}: AcquireButtonProps) {
  const { addItem } = useCart();
  const hintId = useId();
  const showHint = disabled && Boolean(hint);

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        aria-describedby={showHint ? hintId : undefined}
        onClick={() => addItem({ ...product, option })}
        className={cn(
          "inline-flex w-fit items-center justify-center border border-ink bg-ink px-6 py-3 font-sans text-sm text-bone transition-colors duration-200 enabled:hover:border-brass-deep enabled:hover:bg-brass-deep",
          "disabled:cursor-not-allowed disabled:opacity-60",
          className,
        )}
      >
        {label}
      </button>
      {showHint && (
        <p id={hintId} className="font-mono text-xs leading-relaxed text-graphite">
          {hint}
        </p>
      )}
    </>
  );
}
