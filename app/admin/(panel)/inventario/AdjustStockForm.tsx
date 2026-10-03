"use client";

import { useId, useState, type FormEvent } from "react";
import { FormNotice } from "@/components/admin/FormNotice";
import {
  FIELD_CLASS,
  INPUT_CLASS,
  LABEL_CLASS,
  PRIMARY_BUTTON_CLASS,
  SELECT_CLASS,
} from "@/components/admin/styles";
import { useAdminAction } from "@/components/admin/useAdminAction";
import { cn } from "@/lib/cn";
import { ADJUSTMENT_KIND_LABELS } from "@/lib/admin/copy";
import {
  ADJUSTMENT_KINDS,
  type AdjustmentKind,
} from "@/lib/admin/domain/inventory";
import type { MaterialUnit } from "@/lib/admin/domain/quantity";
import { adjustStockAction } from "./actions";

export interface AdjustableMaterial {
  id: string;
  name: string;
  unit: MaterialUnit;
}

// A manual correction: a count that doesn't match, or metal lost in the
// workshop. It changes the stock only (never the average cost), leaves a
// reasoned movement in the history, and the server refuses to go below zero.
// A client island ONLY for the typed result; authorization and validation
// stay on the server (see actions.ts).
export function AdjustStockForm({
  materials,
}: {
  materials: AdjustableMaterial[];
}) {
  const { result, pending, submit } = useAdminAction(adjustStockAction);
  const hintId = useId();
  const [materialId, setMaterialId] = useState("");
  const [delta, setDelta] = useState("");
  const [kind, setKind] = useState<AdjustmentKind>("adjustment");
  const [reason, setReason] = useState("");

  const unit = materials.find((material) => material.id === materialId)?.unit;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    submit(event.currentTarget, () => {
      setMaterialId("");
      setDelta("");
      setKind("adjustment");
      setReason("");
    });
  }

  if (materials.length === 0) {
    return (
      <p className="max-w-prose text-sm leading-relaxed text-graphite">
        Crea un material para poder ajustar sus existencias.
      </p>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-busy={pending}
      className="flex flex-col gap-5"
    >
      <label className={FIELD_CLASS}>
        <span className={LABEL_CLASS}>Material</span>
        <select
          name="materialId"
          required
          value={materialId}
          onChange={(event) => setMaterialId(event.target.value)}
          disabled={pending}
          className={SELECT_CLASS}
        >
          <option value="">Elige un material</option>
          {materials.map((material) => (
            <option key={material.id} value={material.id}>
              {material.name}
            </option>
          ))}
        </select>
      </label>

      <div className="grid gap-5 sm:grid-cols-2">
        <label className={FIELD_CLASS}>
          <span className={LABEL_CLASS}>
            {unit ? `Cantidad (${unit})` : "Cantidad"}
          </span>
          <input
            type="number"
            name="delta"
            required
            step="any"
            aria-describedby={hintId}
            value={delta}
            onChange={(event) => setDelta(event.target.value)}
            disabled={pending}
            className={INPUT_CLASS}
          />
        </label>

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
      </div>
      <p id={hintId} className="-mt-3 text-sm leading-relaxed text-graphite">
        Usa un número negativo para restar, por ejemplo -2.5. Máximo 2 decimales
        en gramos; piezas enteras.
      </p>

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
