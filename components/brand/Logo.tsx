import { cn } from "@/lib/cn";

/**
 * PLACEHOLDER brand logo.
 *
 * The artisan's real vector logo is not available yet — the only reference is a
 * low-resolution raster of her mark. `Mark` below is a hand-approximated SVG of
 * that mark (a scalloped crest/crown over a crossed base), NOT a faithful trace;
 * the "nerea" wordmark is set in the brand serif (Fraunces) and is faithful.
 * When the real vector arrives, replace ONLY this file: everything else consumes
 * <Logo /> and needs no change. Mark and wordmark inherit `currentColor`, so
 * they work on both the light bone canvas and the rare dark obsidian sections.
 */

type LogoVariant = "lockup" | "wordmark" | "mark";

type LogoProps = {
  variant?: LogoVariant;
  className?: string;
  /** Accessible name for the whole logo. Defaults to the brand name. */
  label?: string;
};

function Mark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 47 44"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinejoin="round"
      strokeLinecap="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4 21 A6.5 6.5 0 0 1 17 21 A6.5 6.5 0 0 1 30 21 A6.5 6.5 0 0 1 43 21" />
      <path d="M8 21 L34 40" />
      <path d="M39 21 L13 40" />
    </svg>
  );
}

function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn("font-[family-name:var(--font-fraunces)]", className)}
      style={{ letterSpacing: "0.02em" }}
    >
      nerea
    </span>
  );
}

export function Logo({ variant = "lockup", className, label = "nerea" }: LogoProps) {
  if (variant === "mark") {
    return (
      <span role="img" aria-label={label} className={cn("inline-flex", className)}>
        <Mark className="h-[1em] w-auto" />
      </span>
    );
  }

  if (variant === "wordmark") {
    return (
      <span role="img" aria-label={label} className={cn("inline-flex", className)}>
        <Wordmark className="leading-none" />
      </span>
    );
  }

  return (
    <span
      role="img"
      aria-label={label}
      className={cn("inline-flex items-center gap-[0.55em]", className)}
    >
      <Mark className="h-[1.2em] w-auto opacity-90" />
      <Wordmark className="leading-none" />
    </span>
  );
}
