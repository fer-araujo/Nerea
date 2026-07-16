import { useTranslations } from "next-intl";
import type { Availability } from "@/lib/commerce/types";
import { cn } from "@/lib/cn";

interface AvailabilityBadgeProps {
  availability: Availability;
  /**
   * Edition marker. Every nerea piece is genuinely one-of-one, so this defaults
   * to 01 / 01 — the "1 of 1" is literally true, not decoration.
   */
  edition?: { index: number; total: number };
  /**
   * Optional already-localized spec tokens (e.g. "plata ley .925",
   * "cera perdida", "12 g"). Rendered between the edition marker and the state
   * when a data source provides them. Never fabricated here — the fixture data
   * layer carries no material/weight yet, so the plate stays edition + state
   * until Sanity supplies real specs.
   */
  specs?: string[];
  className?: string;
}

const pad = (n: number) => String(Math.max(0, Math.trunc(n))).padStart(2, "0");

// THE SIGNATURE. A mono "spec-plate" that treats every piece as a documented
// artifact / certificate of authenticity. Strong horizontal datum (MCM):
//   available -> [jade tick] 01 / 01 · <specs> · disponible
//   sold      -> [hollow tick] 01 / 01 · <specs> — vendida   (struck + muted)
// State is conveyed by text AND a non-color signal (line-through / tick shape),
// never color alone.
export function AvailabilityBadge({
  availability,
  edition = { index: 1, total: 1 },
  specs,
  className,
}: AvailabilityBadgeProps) {
  const t = useTranslations("Product");
  const isSold = availability === "sold";
  const editionLabel = `${pad(edition.index)} / ${pad(edition.total)}`;
  const detailTokens = specs?.filter(Boolean) ?? [];

  return (
    <p
      className={cn(
        "flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] leading-none tracking-[0.05em]",
        isSold ? "text-graphite" : "text-ink",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 shrink-0",
          isSold ? "border border-graphite/60" : "bg-jade",
        )}
      />

      <span className={cn(isSold && "line-through decoration-graphite/50")}>
        {editionLabel}
        {detailTokens.map((token) => (
          <span key={token}>
            <span className="mx-1.5 text-graphite/70">&middot;</span>
            {token}
          </span>
        ))}
      </span>

      {isSold ? (
        <span className="line-through decoration-graphite/50">
          &mdash; {t("sold")}
        </span>
      ) : (
        <span className="text-jade">&middot; {t("available")}</span>
      )}
    </p>
  );
}
