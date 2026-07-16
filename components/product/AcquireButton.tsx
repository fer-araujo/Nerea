"use client";

import { cn } from "@/lib/cn";

interface AcquireButtonProps {
  label: string;
  className?: string;
}

// Day 2 placeholder for the acquire/checkout entry point. Cart state and the
// Stripe Checkout handoff don't exist until Day 4 (lib/cart, lib/commerce/
// stripe — see design.md "Day 4 — Cart, Checkout Handoff"), so this is
// intentionally a real, on-brand, clickable CTA (not disabled — the Day 2
// demo should show the full "available" product-detail state) whose click
// handler is a documented no-op. It must never fake a cart action (no toast,
// no state change, no navigation) — that would misrepresent functionality
// that isn't built yet.
export function AcquireButton({ label, className }: AcquireButtonProps) {
  return (
    <button
      type="button"
      // TODO(day-4): wire to lib/cart's add-to-cart action once the cart
      // context and Stripe Checkout Session handoff exist.
      onClick={() => {}}
      className={cn(
        "inline-flex w-fit items-center justify-center border border-ink bg-ink px-6 py-3 font-sans text-sm text-bone transition-colors duration-200 hover:border-brass-deep hover:bg-brass-deep",
        className,
      )}
    >
      {label}
    </button>
  );
}
