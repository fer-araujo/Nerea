"use client";

import { useId, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Price } from "@/components/ui/Price";
import type { ProductOptions, SelectedOption } from "@/lib/commerce/types";
import { cn } from "@/lib/cn";

interface OptionPickerProps {
  /** Only the kinds that need a choice — a piece with no option renders no picker. */
  options: Exclude<ProductOptions, { kind: "none" }>;
  selected: SelectedOption | null;
  onSelect: (option: SelectedOption) => void;
  className?: string;
}

// Ring size / chain length as a group of chips. Built on native radio inputs
// (visually hidden, each chip is the <label> around one) instead of ARIA-only
// buttons: the browser then supplies the whole radio-group keyboard contract
// for free — Tab enters the group, arrow keys move AND select, Space selects —
// plus the checked state and the "n of m" announcement for screen readers.
// What is custom is only the look: a 44px minimum target (WCAG 2.5.8), a
// selected state that is NOT color alone (thicker border + sunk background),
// and a brass focus ring driven by the hidden input's `:focus-visible` through
// `peer-*`, since the input itself has nothing to outline.
export function OptionPicker({
  options,
  selected,
  onSelect,
  className,
}: OptionPickerProps) {
  const t = useTranslations("ProductDetail");
  const groupName = useId();

  const legend =
    options.kind === "ringSize" ? t("ringSizeLegend") : t("chainLengthLegend");

  return (
    <fieldset
      role="radiogroup"
      aria-required="true"
      className={cn("min-w-0", className)}
    >
      <legend className="mb-3 p-0 font-mono text-xs uppercase tracking-[0.14em] text-graphite">
        {legend}
      </legend>

      <div className="flex flex-wrap gap-2">
        {options.kind === "ringSize"
          ? options.values.map((size) => (
              <Chip
                key={size}
                name={groupName}
                checked={selected?.kind === "ringSize" && selected.value === size}
                onSelect={() => onSelect({ kind: "ringSize", value: size })}
              >
                {size}
              </Chip>
            ))
          : options.values.map(({ lengthCm, extra }) => (
              <Chip
                key={lengthCm}
                name={groupName}
                checked={
                  selected?.kind === "chainLength" &&
                  selected.lengthCm === lengthCm
                }
                onSelect={() => onSelect({ kind: "chainLength", lengthCm })}
              >
                <span>{t("chainLengthChip", { cm: lengthCm })}</span>
                {extra > 0 && (
                  <>
                    {/* Whitespace is dropped visually in a flex row, but keeps
                        the radio's accessible name readable ("50 cm +$150.00"). */}
                    {" "}
                    <span className="inline-flex items-center text-graphite">
                      +<Price money={{ amount: extra, currency: "MXN" }} />
                    </span>
                  </>
                )}
              </Chip>
            ))}
      </div>
    </fieldset>
  );
}

interface ChipProps {
  name: string;
  checked: boolean;
  onSelect: () => void;
  children: ReactNode;
}

function Chip({ name, checked, onSelect, children }: ChipProps) {
  return (
    <label className="relative cursor-pointer">
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onSelect}
        className="peer sr-only"
      />
      <span
        className={cn(
          "flex min-h-11 min-w-11 items-center justify-center gap-2 border border-line bg-bone-raised px-3 py-2 font-mono text-sm text-ink transition-colors duration-200",
          "hover:bg-bone-sunk",
          "peer-checked:border-ink peer-checked:bg-bone-sunk peer-checked:ring-1 peer-checked:ring-ink",
          "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brass",
        )}
      >
        {children}
      </span>
    </label>
  );
}
