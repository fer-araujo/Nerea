"use client";

import { useId, useState, type FormEvent } from "react";
import { FormNotice } from "@/components/admin/FormNotice";
import { useModalClose } from "@/components/admin/Modal";
import {
  FIELD_CLASS,
  INPUT_CLASS,
  LABEL_CLASS,
  NUMBER_CLASS,
  PRIMARY_BUTTON_CLASS,
  SELECT_CLASS,
} from "@/components/admin/styles";
import { useAdminAction } from "@/components/admin/useAdminAction";
import { cn } from "@/lib/cn";
import { ADJUSTMENT_KIND_LABELS } from "@/lib/admin/copy";
import {
  ADJUSTMENT_KINDS,
  InventoryError,
  applyAdjustment,
  type AdjustmentKind,
  type StockState,
} from "@/lib/admin/domain/inventory";
import {
  centavosToPesosText,
  formatMXN,
  parsePesosText,
} from "@/lib/admin/domain/money";
import {
  formatQuantity,
  parseQuantityText,
  type MaterialUnit,
} from "@/lib/admin/domain/quantity";
import { adjustStockAction } from "./actions";

export interface AdjustableMaterial {
  id: string;
  name: string;
  unit: MaterialUnit;
  /** Units on hand now. */
  stock: number;
  /** Average cost now, integer centavos per unit. */
  avgCost: number;
}

type Preview =
  | { status: "empty" }
  | { status: "refused"; message: string }
  | { status: "ready"; next: StockState };

function previewAdjustment(
  material: AdjustableMaterial,
  kind: AdjustmentKind,
  deltaText: string,
  costText: string,
): Preview {
  const delta = parseQuantityText(deltaText, { signed: true });
  if (delta === null || delta === 0) {
    return { status: "empty" };
  }
  if (kind === "loss" && delta > 0) {
    return { status: "refused", message: "Una merma se escribe en negativo." };
  }
  const unitCost = delta > 0 ? parsePesosText(costText) : null;
  if (delta > 0 && unitCost === null) {
    return { status: "empty" };
  }

  try {
    return {
      status: "ready",
      next: applyAdjustment(
        { stock: material.stock, avgCost: material.avgCost },
        material.unit,
        kind,
        delta,
        unitCost ?? undefined,
      ),
    };
  } catch (error) {
    if (error instanceof InventoryError) {
      return {
        status: "refused",
        message:
          error.code === "insufficient-stock"
            ? "Las existencias no alcanzan para restar tanto."
            : "La cantidad no es válida para este material.",
      };
    }
    throw error;
  }
}

// An adjustment of ONE material, opened from its row: a write-off (merma) or a
// physical count. A count that adds stock must say what the added units cost,
// because it re-weights the average cost exactly like a purchase would; the
// form shows the resulting stock and average before saving. A client island
// ONLY for the typed result and that preview; authorization and validation stay
// on the server (see actions.ts).
export function AdjustStockForm({ material }: { material: AdjustableMaterial }) {
  const { result, pending, submit } = useAdminAction(adjustStockAction);
  const closeModal = useModalClose();
  const hintId = useId();
  const [kind, setKind] = useState<AdjustmentKind>("adjustment");
  const [delta, setDelta] = useState("");
  // Prefilled with the current average: adding units at the cost they already
  // carry leaves the average where it is.
  const [unitCost, setUnitCost] = useState(() =>
    centavosToPesosText(material.avgCost),
  );
  const [reason, setReason] = useState("");

  const parsedDelta = parseQuantityText(delta, { signed: true });
  const adding = kind === "adjustment" && parsedDelta !== null && parsedDelta > 0;
  const preview = previewAdjustment(material, kind, delta, unitCost);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    submit(event.currentTarget, () => {
      setKind("adjustment");
      setDelta("");
      setUnitCost(centavosToPesosText(material.avgCost));
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
        Ahora hay {formatQuantity(material.stock, material.unit)} a{" "}
        {formatMXN(material.avgCost)} / {material.unit}. ¿Compraste material?
        Usa Registrar compra.
      </p>

      <div className="grid gap-5 sm:grid-cols-2">
        <label className={FIELD_CLASS}>
          <span className={LABEL_CLASS}>Tipo</span>
          <select
            name="kind"
            value={kind}
            onChange={(event) => {
              const next = ADJUSTMENT_KINDS.find(
                (candidate) => candidate === event.target.value,
              );
              if (next) setKind(next);
            }}
            disabled={pending}
            className={SELECT_CLASS}
          >
            {ADJUSTMENT_KINDS.map((option) => (
              <option key={option} value={option}>
                {ADJUSTMENT_KIND_LABELS[option]}
              </option>
            ))}
          </select>
        </label>

        <label className={FIELD_CLASS}>
          <span className={LABEL_CLASS}>Cantidad ({material.unit})</span>
          <input
            type="number"
            name="delta"
            required
            step="any"
            inputMode="decimal"
            aria-describedby={hintId}
            value={delta}
            onChange={(event) => setDelta(event.target.value)}
            disabled={pending}
            className={INPUT_CLASS}
          />
        </label>
      </div>
      <p id={hintId} className="-mt-3 text-sm leading-relaxed text-graphite">
        Usa un número negativo para restar, por ejemplo -2.5. Máximo 2 decimales
        en gramos; piezas enteras.
      </p>

      {adding ? (
        <label className={FIELD_CLASS}>
          <span className={LABEL_CLASS}>
            Costo por unidad (MXN / {material.unit})
          </span>
          <input
            type="number"
            name="unitCost"
            required
            min="0"
            step="0.01"
            inputMode="decimal"
            value={unitCost}
            onChange={(event) => setUnitCost(event.target.value)}
            disabled={pending}
            className={INPUT_CLASS}
          />
        </label>
      ) : null}

      <label className={FIELD_CLASS}>
        <span className={LABEL_CLASS}>Motivo</span>
        <input
          type="text"
          name="reason"
          required
          minLength={3}
          maxLength={200}
          autoComplete="off"
          placeholder="Conteo físico, limaduras, error de captura…"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          disabled={pending}
          className={INPUT_CLASS}
        />
      </label>

      <div
        aria-live="polite"
        className="flex flex-col gap-2 border-t border-line pt-4"
      >
        <span className={LABEL_CLASS}>Quedaría así</span>
        {preview.status === "ready" ? (
          <dl className="flex flex-col gap-1 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <dt className="text-graphite">Existencias</dt>
              <dd className={cn(NUMBER_CLASS, "text-ink")}>
                {formatQuantity(preview.next.stock, material.unit)}
              </dd>
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <dt className="text-graphite">Costo promedio</dt>
              <dd className={cn(NUMBER_CLASS, "text-ink")}>
                {formatMXN(preview.next.avgCost)} / {material.unit}
              </dd>
            </div>
          </dl>
        ) : preview.status === "refused" ? (
          <p className="text-sm text-ink">{preview.message}</p>
        ) : (
          <p className="text-sm text-graphite">
            Escribe la cantidad para ver cómo quedan las existencias y el costo
            promedio.
          </p>
        )}
      </div>

      <FormNotice result={result} successText="Existencias ajustadas." />

      <button
        type="submit"
        disabled={pending}
        className={cn(PRIMARY_BUTTON_CLASS, "self-start")}
      >
        {pending ? "Ajustando…" : "Ajustar existencias"}
      </button>
    </form>
  );
}
