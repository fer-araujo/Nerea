"use client";

import { useId, useState, type FormEvent } from "react";
import { FormNotice } from "@/components/admin/FormNotice";
import {
  FIELD_CLASS,
  INPUT_CLASS,
  LABEL_CLASS,
  NOTICE_ERROR_CLASS,
  NUMBER_CLASS,
  PRIMARY_BUTTON_CLASS,
  QUIET_BUTTON_CLASS,
  SELECT_CLASS,
} from "@/components/admin/styles";
import { useAdminAction } from "@/components/admin/useAdminAction";
import { cn } from "@/lib/cn";
import {
  centavosToPesosText,
  formatMXN,
  pesosToCentavos,
} from "@/lib/admin/domain/money";
import {
  formatPercent,
  metalCostFromGrams,
  pieceMargin,
} from "@/lib/admin/domain/pieces";
import { savePieceCostAction } from "./actions";

/** A material the metal can be priced from: weighed in grams, with its cost. */
export interface PieceCostMaterial {
  id: string;
  name: string;
  /** Current average cost, integer centavos per gram. */
  avgCost: number;
}

/** Every field as the form holds it: text, so a blank stays blank. */
export interface PieceCostValues {
  metal: string;
  stones: string;
  other: string;
  labor: string;
  metalGrams: string;
  materialId: string;
  note: string;
}

const MONEY_PATTERN = /^\d{1,8}(?:\.\d{1,2})?$/;
const GRAMS_PATTERN = /^\d{1,6}(?:\.\d{1,3})?$/;

/** What the live preview counts: only a field that is already a valid amount. */
function costToCentavos(text: string): number {
  const trimmed = text.trim();
  return MONEY_PATTERN.test(trimmed) ? pesosToCentavos(Number(trimmed)) : 0;
}

function parseGrams(text: string): number | null {
  const trimmed = text.trim();
  if (!GRAMS_PATTERN.test(trimmed)) return null;
  const grams = Number(trimmed);
  return grams > 0 ? grams : null;
}

// Edits the cost of ONE piece. A client island ONLY for the live total and
// margin, the "Calcular metal" helper and the typed result — the server action
// authorizes, validates every field again and does the real write (see
// actions.ts). The price comes from the catalog and is read-only here; the
// margin shown is a convenience, never what gets stored.
export function PieceCostForm({
  handle,
  title,
  price,
  initial,
  materials,
  materialsUnavailable,
}: {
  handle: string;
  title: string;
  /** The catalog price, integer centavos. */
  price: number;
  initial: PieceCostValues;
  materials: PieceCostMaterial[];
  /** The materials could not be read: the helper is off, the field still works. */
  materialsUnavailable: boolean;
}) {
  const { result, pending, submit } = useAdminAction(savePieceCostAction);
  const helperHintId = useId();
  const [metal, setMetal] = useState(initial.metal);
  const [stones, setStones] = useState(initial.stones);
  const [other, setOther] = useState(initial.other);
  const [labor, setLabor] = useState(initial.labor);
  const [metalGrams, setMetalGrams] = useState(initial.metalGrams);
  const [materialId, setMaterialId] = useState(initial.materialId);
  const [note, setNote] = useState(initial.note);

  const material = materials.find((candidate) => candidate.id === materialId);
  const grams = parseGrams(metalGrams);
  const canCalculate = material !== undefined && grams !== null;

  const anyCost = [metal, stones, other, labor].some(
    (text) => text.trim() !== "",
  );
  const total =
    costToCentavos(metal) +
    costToCentavos(stones) +
    costToCentavos(other) +
    costToCentavos(labor);
  const { margin, marginPercent } = pieceMargin(price, total);

  // Fills the metal field with grams x the material's CURRENT average cost per
  // gram. A suggestion: the field stays editable.
  function calculateMetal() {
    if (!material || grams === null) return;
    setMetal(centavosToPesosText(metalCostFromGrams(grams, material.avgCost)));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    // No onSuccess reset: this form EDITS a saved record, so what was typed is
    // exactly what is now stored.
    submit(event.currentTarget);
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-busy={pending}
      className="flex flex-col gap-6"
    >
      <input type="hidden" name="handle" value={handle} />

      <div>
        <p className={LABEL_CLASS}>Pieza</p>
        <p className="mt-1 font-display text-xl leading-snug text-ink [overflow-wrap:anywhere]">
          {title || "Sin nombre"}
        </p>
        <p className={cn(NUMBER_CLASS, "mt-1 text-sm text-graphite")}>
          Precio en la tienda: {formatMXN(price)}
        </p>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <label className={FIELD_CLASS}>
          <span className={LABEL_CLASS}>Metal (MXN)</span>
          <input
            type="number"
            name="metal"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={metal}
            onChange={(event) => setMetal(event.target.value)}
            disabled={pending}
            className={INPUT_CLASS}
          />
        </label>

        <label className={FIELD_CLASS}>
          <span className={LABEL_CLASS}>Piedras (MXN)</span>
          <input
            type="number"
            name="stones"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={stones}
            onChange={(event) => setStones(event.target.value)}
            disabled={pending}
            className={INPUT_CLASS}
          />
        </label>

        <label className={FIELD_CLASS}>
          <span className={LABEL_CLASS}>Otros (MXN)</span>
          <input
            type="number"
            name="other"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={other}
            onChange={(event) => setOther(event.target.value)}
            disabled={pending}
            className={INPUT_CLASS}
          />
        </label>

        <label className={FIELD_CLASS}>
          <span className={LABEL_CLASS}>Mano de obra (MXN, opcional)</span>
          <input
            type="number"
            name="labor"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={labor}
            onChange={(event) => setLabor(event.target.value)}
            disabled={pending}
            className={INPUT_CLASS}
          />
        </label>
      </div>

      <fieldset className="min-w-0 border border-line bg-bone-raised p-4">
        <legend className={cn(LABEL_CLASS, "px-1")}>Calcular metal</legend>

        {materialsUnavailable || materials.length === 0 ? (
          <>
            {/* The helper's own fields are not on screen, but saving REPLACES
                the whole record: what it stored earlier rides along so it is
                not silently erased. */}
            <input type="hidden" name="metalGrams" value={metalGrams} />
            <input type="hidden" name="materialId" value={materialId} />
            {materialsUnavailable ? (
              <p role="alert" className={NOTICE_ERROR_CLASS}>
                No pudimos cargar tus materiales. Puedes escribir el costo del
                metal a mano o recargar la página para calcularlo.
              </p>
            ) : (
              <p className="text-sm leading-relaxed text-graphite">
                Crea un material de plata, oro o liga en Inventario para
                calcular el costo del metal a partir de sus gramos.
              </p>
            )}
          </>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className={FIELD_CLASS}>
                <span className={LABEL_CLASS}>Material</span>
                <select
                  name="materialId"
                  value={materialId}
                  onChange={(event) => setMaterialId(event.target.value)}
                  aria-describedby={helperHintId}
                  disabled={pending}
                  className={SELECT_CLASS}
                >
                  <option value="">Elige un material</option>
                  {materials.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name} · {formatMXN(option.avgCost)} / g
                    </option>
                  ))}
                </select>
              </label>

              <label className={FIELD_CLASS}>
                <span className={LABEL_CLASS}>Gramos de metal</span>
                <input
                  type="number"
                  name="metalGrams"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  value={metalGrams}
                  onChange={(event) => setMetalGrams(event.target.value)}
                  aria-describedby={helperHintId}
                  disabled={pending}
                  className={INPUT_CLASS}
                />
              </label>
            </div>

            <p
              id={helperHintId}
              className="mt-3 text-sm leading-relaxed text-graphite"
            >
              Gramos × costo promedio por gramo del material
              {material ? ` (${formatMXN(material.avgCost)} / g)` : ""}. Llena el
              campo de metal; puedes ajustarlo después.
            </p>

            <button
              type="button"
              onClick={calculateMetal}
              disabled={pending || !canCalculate}
              className={cn(QUIET_BUTTON_CLASS, "mt-1")}
            >
              Calcular metal
            </button>
          </>
        )}
      </fieldset>

      <label className={FIELD_CLASS}>
        <span className={LABEL_CLASS}>Nota (opcional)</span>
        <input
          type="text"
          name="note"
          maxLength={300}
          autoComplete="off"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          disabled={pending}
          className={INPUT_CLASS}
        />
      </label>

      <div
        aria-live="polite"
        className="flex flex-col gap-2 border-t border-line pt-4"
      >
        <p className="flex flex-wrap items-baseline justify-between gap-2">
          <span className={LABEL_CLASS}>Costo total</span>
          <span className={cn(NUMBER_CLASS, "text-xl text-ink")}>
            {formatMXN(total)}
          </span>
        </p>
        {anyCost ? (
          <p className="flex flex-wrap items-baseline justify-between gap-2">
            <span className={LABEL_CLASS}>Utilidad</span>
            <span className={cn(NUMBER_CLASS, "text-base text-ink")}>
              {formatMXN(margin)}
              {marginPercent !== null ? ` · ${formatPercent(marginPercent)}` : ""}
            </span>
          </p>
        ) : (
          <p className="text-sm text-graphite">
            Escribe los costos para ver la utilidad de la pieza.
          </p>
        )}
      </div>

      <FormNotice result={result} successText="Costo guardado." />

      <button
        type="submit"
        disabled={pending}
        className={cn(PRIMARY_BUTTON_CLASS, "self-start")}
      >
        {pending ? "Guardando…" : "Guardar costo"}
      </button>
    </form>
  );
}
