import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

type BadgeVariant = "ink" | "jade" | "muted" | "brass";

interface BadgeProps {
  children: ReactNode;
  variant?: BadgeVariant;
  className?: string;
}

// Sharp-cornered mono tag (the whole system commits to radius 0 — MCM). Text
// colors are kept high-contrast for AA; brass appears as the border accent
// rather than as small brass-on-bone text (which would fail contrast).
const VARIANTS: Record<BadgeVariant, string> = {
  ink: "border-ink/25 text-ink",
  jade: "border-jade/40 text-jade",
  muted: "border-line text-graphite",
  brass: "border-brass text-ink",
};

export function Badge({ children, variant = "ink", className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em]",
        VARIANTS[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}
