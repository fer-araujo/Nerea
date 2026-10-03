"use client";

import { useState, type FormEvent } from "react";
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
import { MATERIAL_KIND_LABELS, MATERIAL_UNIT_LABELS } from "@/lib/admin/copy";
import { MATERIAL_KINDS, type MaterialKind } from "@/lib/admin/domain/inventory";
import { MATERIAL_UNITS, type MaterialUnit } from "@/lib/admin/domain/quantity";
import { createMaterialAction } from "./actions";

// Anything that is weighed is counted in grams; stones and miscellany by the
// piece. A starting suggestion only — the admin can still change the unit.
function defaultUnit(kind: MaterialKind): MaterialUnit {
  return kind === "stone" || kind === "other" ? "pz" : "g";
}

// A client island ONLY for the typed result and the kind -> unit suggestion;
// the write, and its authorization and validation, stay on the server (see
// actions.ts). A new material always starts at zero: stock arrives by
// registering a purchase.
export function CreateMaterialForm() {
  const { result, pending, submit } = useAdminAction(createMaterialAction);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<MaterialKind>("fine_silver");
  const [unit, setUnit] = useState<MaterialUnit>("g");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    submit(event.currentTarget, () => {
      setName("");
      setKind("fine_silver");
      setUnit("g");
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-busy={pending}
      className="flex flex-col gap-5"
    >
      <p className="max-w-prose text-sm leading-relaxed text-graphite">
        Un material nuevo empieza en 0. Las existencias llegan al registrar una
        compra en Inversiones.
      </p>

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
