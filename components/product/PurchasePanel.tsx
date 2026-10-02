"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AcquireButton } from "@/components/product/AcquireButton";
import { OptionPicker } from "@/components/product/OptionPicker";
import { validateOption } from "@/lib/commerce/options";
import type { Product, SelectedOption } from "@/lib/commerce/types";
import { cn } from "@/lib/cn";

interface PurchasePanelProps {
  label: string;
  /**
   * Only what the panel needs — the product page is a Server Component, so
   * everything passed here is serialized into the client payload. Gallery
   * media and the description stay on the server.
   */
  product: Pick<Product, "handle" | "title" | "price" | "cover" | "options">;
  className?: string;
}

// Owns the shopper's option choice for one piece: renders the picker (when
// the piece takes an option) and the acquire button, which stays disabled
// until the choice is valid. Selection is local state — nothing about it
// leaves the page until "acquire" puts it on the cart line.
export function PurchasePanel({ label, product, className }: PurchasePanelProps) {
  const t = useTranslations("ProductDetail");
  const [selected, setSelected] = useState<SelectedOption | null>(null);
  const { options } = product;

  // Derived during render rather than mirrored into state: the same
  // validation `checkoutAction` applies server-side, so the button can only
  // enable for a choice the server will accept. `check.extra` comes from the
  // piece's own option list, not from anything the shopper typed.
  const check = validateOption(options, selected);
  const extra = check.valid ? check.extra : 0;

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {options.kind !== "none" && (
        <OptionPicker options={options} selected={selected} onSelect={setSelected} />
      )}
      <AcquireButton
        label={label}
        product={{
          handle: product.handle,
          title: product.title,
          // Display-only: base price + the chosen option's extra. The real
          // charge is re-priced from the catalog server-side.
          price: {
            ...product.price,
            amount: product.price.amount + extra,
          },
          cover: product.cover,
        }}
        option={check.valid ? (check.option ?? undefined) : undefined}
        disabled={!check.valid}
        hint={
          check.valid
            ? undefined
            : options.kind === "chainLength"
              ? t("chainLengthHint")
              : t("ringSizeHint")
        }
      />
    </div>
  );
}
