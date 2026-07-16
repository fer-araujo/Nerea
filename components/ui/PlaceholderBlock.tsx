import { cn } from "@/lib/cn";

interface PlaceholderBlockProps {
  className?: string;
  /**
   * Cycles through a small palette of tinted tones so a catalog grid with
   * several un-photographed pieces reads as distinct pieces instead of
   * identical blocks. Pass the item's position in its list (e.g. the
   * `.map` index) — tones repeat every 3 items, but that's guaranteed
   * non-repeating for any 3 consecutive items, unlike hashing a handle
   * string into 3 buckets (tried first; collided for 2 of the 3 shipped
   * fixtures — 3 items into 3 hash buckets collides far more often than it
   * doesn't). Every tone is a low-opacity tint of an already-approved token
   * (graphite/brass/obsidian) — no new colors. Omit for a standalone
   * placeholder with no siblings to visually collide with (e.g. the product
   * detail gallery) to get the neutral bone-sunk well.
   */
  toneIndex?: number;
}

const TONES = ["bg-graphite/12", "bg-brass/12", "bg-obsidian/10"];

function toneFor(toneIndex?: number): string {
  if (toneIndex === undefined) return "bg-bone-sunk";
  return TONES[((toneIndex % TONES.length) + TONES.length) % TONES.length];
}

// Material-tone stand-in for a piece with no photograph yet. Renders the
// atelier mark centered on a tinted well via CSS background (no <img>, no
// broken image, no next/image SVG-optimization opt-in). Decorative only.
export function PlaceholderBlock({ className, toneIndex }: PlaceholderBlockProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(toneFor(toneIndex), className)}
      style={{
        backgroundImage: "url('/placeholder-piece.svg')",
        backgroundRepeat: "no-repeat",
        backgroundPosition: "center",
        backgroundSize: "38%",
      }}
    />
  );
}
