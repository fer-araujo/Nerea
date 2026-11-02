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
  SELECT_CLASS,
} from "@/components/admin/styles";
import { useAdminAction } from "@/components/admin/useAdminAction";
import { cn } from "@/lib/cn";
import { MATERIAL_KIND_LABELS, MATERIAL_UNIT_LABELS } from "@/lib/admin/copy";
import { MATERIAL_KINDS, type MaterialKind } from "@/lib/admin/domain/inventory";
import {
  formatMXN,
  parsePesosText,
  unitCostFromTotal,
} from "@/lib/admin/domain/money";
import {
  MATERIAL_UNITS,
  parseQuantityText,
  type MaterialUnit,
} from "@/lib/admin/domain/quantity";
import { createMaterialAction } from "./actions";

// Anything that is weighed is counted in grams; stones and miscellany by the
// piece. A starting suggestion only — the admin can still change the unit.
function defaultUnit(kind: MaterialKind): MaterialUnit {
  return kind === "stone" || kind === "other" ? "pz" : "g";
}

// A client island ONLY for the typed result, the kind -> unit suggestion and
// the average-cost preview; the write, and its authorization and validation,
// stay on the server (see actions.ts). The opening stock is optional: with a
// quantity AND what it cost in total, the material starts with that stock at
// that average cost, recorded as an "Inventario inicial" purchase.
export function CreateMaterialForm() {
  const { result, pending, submit } = useAdminAction(createMaterialAction);
  const closeModal = useModalClose();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<MaterialKind>("fine_silver");
  const [unit, setUnit] = useState<MaterialUnit>("g");
  const [initialQty, setInitialQty] = useState("");
  const [initialCost, setInitialCost] = useState("");

  const qty = parseQuantityText(initialQty);
  const hasStock = qty !== null && qty > 0;
  const totalCost = parsePesosText(initialCost);
  const averageCost =
    hasStock && totalCost !== null ? unitCostFromTotal(totalCost, qty) : null;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    submit(event.currentTarget, () => {
      setName("");
      setKind("fine_silver");
      setUnit("g");
      setInitialQty("");
      setInitialCost("");
      closeModal();
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-busy={pending}
      className="flex flex-col gap-5"
    >
      <label className={FIELD_CLASS}>
        <span className={LABEL_CLASS}>Nombre</span>
        <input
          type="text"
          name="name"
          required
          maxLength={80}
          autoComplete="off"
          placeholder="Plata fina .999"
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={pending}
          className={INPUT_CLASS}
        />
      </label>

      <div className="grid gap-5 sm:grid-cols-2">
        <label className={FIELD_CLASS}>
          <span className={LABEL_CLASS}>Tipo</span>
          <select
            name="kind"
            value={kind}
            onChange={(event) => {
              const next = MATERIAL_KINDS.find(
                (candidate) => candidate === event.target.value,
              );
              if (next) {
                setKind(next);
                setUnit(defaultUnit(next));
              }
            }}
            disabled={pending}
            className={SELECT_CLASS}
          >
            {MATERIAL_KINDS.map((option) => (
              <option key={option} value={option}>
                {MATERIAL_KIND_LABELS[option]}
              </option>
            ))}
          </select>
        </label>

        <label className={FIELD_CLASS}>
          <span className={LABEL_CLASS}>Unidad</span>
          <select
            name="unit"
            value={unit}
            onChange={(event) => {
              const next = MATERIAL_UNITS.find(
                (candidate) => candidate === event.target.value,
              );
              if (next) setUnit(next);
            }}
            disabled={pending}
            className={SELECT_CLASS}
          >
            {MATERIAL_UNITS.map((option) => (
              <option key={option} value={option}>
                {MATERIAL_UNIT_LABELS[option]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <fieldset className="flex min-w-0 flex-col gap-4 border border-line bg-bone-raised p-4">
        <legend className={cn(LABEL_CLASS, "px-1")}>Lo que ya tienes</legend>
        <p className="max-w-prose text-sm leading-relaxed text-graphite">
          Opcional. Si ya tienes este material, escribe cuánto y cuánto te costó
          en total, para que el inventario y el costo promedio partan de un
          valor real. Si lo dejas en blanco empieza en 0 y las existencias
          llegan al registrar una compra.
        </p>

        <div className="grid gap-5 sm:grid-cols-2">
          <label className={FIELD_CLASS}>
            <span className={LABEL_CLASS}>Cantidad inicial ({unit})</span>
            <input
              type="number"
              name="initialQty"
              min="0"
              step="any"
              inputMode="decimal"
              value={initialQty}
              onChange={(event) => setInitialQty(event.target.value)}
              disabled={pending}
              className={INPUT_CLASS}
            />
          </label>

          <label className={FIELD_CLASS}>
            <span className={LABEL_CLASS}>Costo total (MXN)</span>
            <input
              type="number"
              name="initialCost"
              required={hasStock}
              min="0"
              step="0.01"
              inputMode="decimal"
              value={initialCost}
              onChange={(event) => setInitialCost(event.target.value)}
              disabled={pending}
              className={INPUT_CLASS}
            />
          </label>
        </div>

        {averageCost !== null ? (
          <p
            aria-live="polite"
            className="flex flex-wrap items-baseline justify-between gap-2 border-t border-line pt-3"
          >
            <span className={LABEL_CLASS}>Costo promedio</span>
            <span className={cn(NUMBER_CLASS, "text-base text-ink")}>
              {formatMXN(averageCost)} / {unit}
            </span>
          </p>
        ) : null}
      </fieldset>

      <FormNotice result={result} successText="Material creado." />

      <button
        type="submit"
        disabled={pending}
        className={cn(PRIMARY_BUTTON_CLASS, "self-start")}
      >
        {pending ? "Creando…" : "Crear material"}
      </button>
    </form>
  );
}
