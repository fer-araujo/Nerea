import { cn } from "@/lib/cn";

interface PlaceholderBlockProps {
  className?: string;
}

// Material-tone stand-in for a piece with no photograph yet. Renders the
// atelier mark centered on a bone-sunk well via CSS background (no <img>, no
// broken image, no next/image SVG-optimization opt-in). Decorative only.
export function PlaceholderBlock({ className }: PlaceholderBlockProps) {
  return (
    <div
      aria-hidden="true"
      className={cn("bg-bone-sunk", className)}
      style={{
        backgroundImage: "url('/placeholder-piece.svg')",
        backgroundRepeat: "no-repeat",
        backgroundPosition: "center",
        backgroundSize: "38%",
      }}
    />
  );
}
