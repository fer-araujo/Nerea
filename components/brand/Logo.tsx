import { cn } from "@/lib/cn";

/**
 * Brand logo, with an artisan-uploadable override.
 *
 * `src` (siteSettings.logo, see lib/site-settings) takes priority when set —
 * Studio's "Ajustes del sitio" singleton lets the artisan upload her real
 * logo without a code change. Until then, this file's coded placeholder is
 * the fallback: `Mark` is a hand-approximated SVG of her mark (a scalloped
 * crest/crown over a crossed base), NOT a faithful trace, and the "nerea"
 * wordmark is set in the brand serif (Fraunces) and is faithful. Mark and
 * wordmark inherit `currentColor`, so they work on both the light bone
 * canvas and the rare dark obsidian sections; an uploaded `src` sizes the
 * same way but does not recolor (it renders whatever the artisan uploaded).
 */

type LogoVariant = "lockup" | "wordmark" | "mark";

type LogoProps = {
  variant?: LogoVariant;
  className?: string;
  /** Accessible name for the whole logo. Defaults to the brand name. */
  label?: string;
  /**
   * Resolved URL of an artisan-uploaded logo. When present, it fully
   * replaces the placeholder mark+wordmark below, regardless of `variant` —
   * a single uploaded asset is assumed to be the artisan's complete lockup,
   * not a mark-only crop that code should try to split.
   *
   * SECURITY: rendered ONLY via a plain `<img>` — never inlined as SVG
   * markup, never `dangerouslySetInnerHTML`. An `<img src>` cannot execute a
   * `<script>` embedded in an SVG file the way an inline `<svg>`/innerHTML
   * render can, so this stays safe even though the upload accepts
   * `image/svg+xml`.
   */
  src?: string;
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

export function Logo({ variant = "lockup", className, label = "nerea", src }: LogoProps) {
  if (src) {
    return (
      <span
        role="img"
        aria-label={label}
        className={cn("inline-flex items-center", className)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- uploaded brand
            asset, arbitrary aspect ratio/format (incl. SVG); sized via
            em-relative classes that don't fit next/image's width+height/fill
            contract. See the SECURITY note on LogoProps.src above. */}
        <img src={src} alt="" className="h-[1.2em] w-auto object-contain" />
      </span>
    );
  }

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
