"use client";

import { useState, type FormEvent } from "react";
import { FormNotice } from "@/components/admin/FormNotice";
import { useModalClose } from "@/components/admin/Modal";
import {
  FIELD_CLASS,
  INPUT_CLASS,
  LABEL_CLASS,
  NUMBER_CLASS,
  PRIMARY_BUTTON_CLASS,
} from "@/components/admin/styles";
import { useAdminAction } from "@/components/admin/useAdminAction";
import { cn } from "@/lib/cn";
import {
  centavosToPesosText,
  formatMXN,
  inventoryValue,
  parsePesosText,
} from "@/lib/admin/domain/money";
import {
  formatQuantity,
  parseQuantityText,
  type MaterialUnit,
} from "@/lib/admin/domain/quantity";
import { correctStockAction } from "./actions";
import type { AdjustableMaterial } from "./AdjustStockForm";

export type CorrectableMaterial = AdjustableMaterial;

/** The stock as a form value: whole pieces, or grams with two decimals. */
function stockText(stock: number, unit: MaterialUnit): string {
  return unit === "pz" ? String(Math.round(stock)) : stock.toFixed(2);
}

// "Corregir": the way out of a wrong figure. The admin states the REAL stock and
// the REAL average cost per unit, and the ledger is brought to them (a purchase
// or an adjustment could only dilute a wrong average, never fix it). The form
// shows the current values next to the new ones before she confirms. A client
// island ONLY for the typed result and that comparison; authorization and
// validation stay on the server (see actions.ts).
export function CorrectStockForm({ material }: { material: CorrectableMaterial }) {
  const { result, pending, submit } = useAdminAction(correctStockAction);
  const closeModal = useModalClose();
  const [stock, setStock] = useState(() => stockText(material.stock, material.unit));
  const [avgCost, setAvgCost] = useState(() =>
    centavosToPesosText(material.avgCost),
  );
  const [reason, setReason] = useState("");

  const nextStock = parseQuantityText(stock);
  const nextAvgCost = parsePesosText(avgCost);
  const ready = nextStock !== null && nextAvgCost !== null;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    submit(event.currentTarget, () => {
      setReason("");
      closeModal();
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-busy={pending}
      className="flex flex-col gap-5"
    >
      <input type="hidden" name="materialId" value={material.id} />

      <p className="max-w-prose text-sm leading-relaxed text-graphite">
        Escribe las existencias reales y el costo promedio real por unidad. Se
        guardan tal cual y queda un movimiento de corrección en el historial.
      </p>

      <div className="grid gap-5 sm:grid-cols-2">
        <label className={FIELD_CLASS}>
          <span className={LABEL_CLASS}>Existencias reales ({material.unit})</span>
          <input
            type="number"
            name="stock"
            required
            min="0"
            step="any"
            inputMode="decimal"
            value={stock}
            onChange={(event) => setStock(event.target.value)}
            disabled={pending}
            className={INPUT_CLASS}
          />
        </label>

        <label className={FIELD_CLASS}>
          <span className={LABEL_CLASS}>
            Costo promedio real (MXN / {material.unit})
          </span>
          <input
            type="number"
            name="avgCost"
            required
            min="0"
            step="0.01"
            inputMode="decimal"
            value={avgCost}
            onChange={(event) => setAvgCost(event.target.value)}
            disabled={pending}
            className={INPUT_CLASS}
          />
        </label>
      </div>

      <label className={FIELD_CLASS}>
        <span className={LABEL_CLASS}>Motivo</span>
        <input
          type="text"
          name="reason"
          required
          minLength={3}
          maxLength={200}
          autoComplete="off"
          placeholder="Error al registrar la compra, conteo real…"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          disabled={pending}
          className={INPUT_CLASS}
        />
      </label>

      <div
        aria-live="polite"
        className="flex flex-col gap-3 border-t border-line pt-4"
      >
        <span className={LABEL_CLASS}>Antes y después</span>
        <table className="w-full border-collapse text-left text-sm">
          <caption className="sr-only">
            Existencias, costo promedio y valor de {material.name}, actuales y
            después de corregir
          </caption>
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="py-2 pr-3 font-normal" />
              <th scope="col" className={cn(LABEL_CLASS, "px-3 py-2 text-right font-normal")}>
                Actual
              </th>
              <th scope="col" className={cn(LABEL_CLASS, "py-2 pl-3 text-right font-normal")}>
                Nuevo
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            <tr>
              <th scope="row" className="py-2 pr-3 font-normal text-graphite">
                Existencias
              </th>
              <td className={cn(NUMBER_CLASS, "px-3 py-2 text-right text-graphite")}>
                {formatQuantity(material.stock, material.unit)}
              </td>
              <td className={cn(NUMBER_CLASS, "py-2 pl-3 text-right text-ink")}>
                {nextStock === null ? "—" : formatQuantity(nextStock, material.unit)}
              </td>
            </tr>
            <tr>
              <th scope="row" className="py-2 pr-3 font-normal text-graphite">
                Costo promedio
              </th>
              <td className={cn(NUMBER_CLASS, "px-3 py-2 text-right text-graphite")}>
                {formatMXN(material.avgCost)} / {material.unit}
              </td>
              <td className={cn(NUMBER_CLASS, "py-2 pl-3 text-right text-ink")}>
                {nextAvgCost === null ? "—" : `${formatMXN(nextAvgCost)} / ${material.unit}`}
              </td>
            </tr>
            <tr>
              <th scope="row" className="py-2 pr-3 font-normal text-graphite">
                Valor
              </th>
              <td className={cn(NUMBER_CLASS, "px-3 py-2 text-right text-graphite")}>
                {formatMXN(inventoryValue(material.stock, material.avgCost))}
              </td>
              <td className={cn(NUMBER_CLASS, "py-2 pl-3 text-right text-ink")}>
                {ready ? formatMXN(inventoryValue(nextStock, nextAvgCost)) : "—"}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <FormNotice result={result} successText="Existencias y costo corregidos." />

      <button
        type="submit"
        disabled={pending}
        className={cn(PRIMARY_BUTTON_CLASS, "self-start")}
      >
        {pending ? "Corrigiendo…" : "Corregir"}
      </button>
    </form>
  );
}
