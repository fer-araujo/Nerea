"use client";

import { useRef, useState, type FormEvent } from "react";
import { FormNotice } from "@/components/admin/FormNotice";
import {
  FIELD_CLASS,
  INPUT_CLASS,
  LABEL_CLASS,
  NUMBER_CLASS,
  PRIMARY_BUTTON_CLASS,
  QUIET_BUTTON_CLASS,
  SELECT_CLASS,
} from "@/components/admin/styles";
import { useAdminAction } from "@/components/admin/useAdminAction";
import { cn } from "@/lib/cn";
import { MAX_PURCHASE_ITEMS } from "@/lib/admin/domain/inventory";
import { formatMXN, pesosToCentavos } from "@/lib/admin/domain/money";
import type { MaterialUnit } from "@/lib/admin/domain/quantity";
import { recordPurchaseAction } from "./actions";

export interface PurchaseMaterial {
  id: string;
  name: string;
  unit: MaterialUnit;
}

interface Row {
  /** Stable React key; never reused while the row exists. */
  key: number;
  materialId: string;
  qty: string;
  cost: string;
}

const OPENING_INVENTORY = "Inventario inicial";
const MONEY_PATTERN = /^\d{1,8}(?:\.\d{1,2})?$/;

function emptyRow(key: number): Row {
  return { key, materialId: "", qty: "", cost: "" };
}

/** What the live total counts: only a cost that is already a valid amount. */
function costToCentavos(text: string): number {
  const trimmed = text.trim();
  return MONEY_PATTERN.test(trimmed) ? pesosToCentavos(Number(trimmed)) : 0;
}

// Registers one purchase of one or more materials. A client island ONLY for
// the item rows, the live total and the typed result — the server action
// authorizes, validates every field again and does the real work (stock,
// average cost and history change in one transaction; see actions.ts). The
// total shown here is a convenience, never what gets stored.
export function PurchaseForm({
  materials,
  today,
}: {
  materials: PurchaseMaterial[];
  /** `YYYY-MM-DD` in Mexico City, computed on the server. */
  today: string;
}) {
  const { result, pending, submit } = useAdminAction(recordPurchaseAction);
  const nextKey = useRef(1);
  const [rows, setRows] = useState<Row[]>(() => [emptyRow(0)]);
  const [date, setDate] = useState(today);
  const [supplier, setSupplier] = useState("");
  const [note, setNote] = useState("");

  const total = rows.reduce((sum, row) => sum + costToCentavos(row.cost), 0);

  function updateRow(key: number, patch: Partial<Omit<Row, "key">>) {
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
  }

  function addRow() {
    const key = nextKey.current;
    nextKey.current += 1;
    setRows((current) =>
      current.length < MAX_PURCHASE_ITEMS
        ? [...current, emptyRow(key)]
        : current,
    );
  }

  function removeRow(key: number) {
    setRows((current) =>
      current.length > 1 ? current.filter((row) => row.key !== key) : current,
    );
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    submit(event.currentTarget, () => {
      nextKey.current = 1;
      setRows([emptyRow(0)]);
      setDate(today);
      setSupplier("");
      setNote("");
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-busy={pending}
      className="flex flex-col gap-6"
    >
      <p className="max-w-prose text-sm leading-relaxed text-graphite">
        ¿Cargas lo que ya tienes? Regístralo como una compra llamada «
        {OPENING_INVENTORY}» con su costo, para que el inventario y el costo
        promedio partan de un valor real.
      </p>

      <div className="grid gap-5 sm:grid-cols-2">
        <label className={FIELD_CLASS}>
          <span className={LABEL_CLASS}>Fecha</span>
          <input
            type="date"
            name="date"
            required
            max={today}
            value={date}
            onChange={(event) => setDate(event.target.value)}
            disabled={pending}
            className={INPUT_CLASS}
          />
        </label>

        <div className={FIELD_CLASS}>
          <label className={FIELD_CLASS}>
            <span className={LABEL_CLASS}>Proveedor o concepto</span>
            <input
              type="text"
              name="supplier"
              maxLength={120}
              autoComplete="off"
              value={supplier}
              onChange={(event) => setSupplier(event.target.value)}
              disabled={pending}
              className={INPUT_CLASS}
            />
          </label>
          <button
            type="button"
            onClick={() => setSupplier(OPENING_INVENTORY)}
            disabled={pending}
            className={cn(QUIET_BUTTON_CLASS, "self-start")}
          >
            Usar «{OPENING_INVENTORY}»
          </button>
        </div>
      </div>

      <ul className="flex flex-col gap-4">
        {rows.map((row, index) => {
          const unit = materials.find(
            (material) => material.id === row.materialId,
          )?.unit;

          return (
            <li key={row.key} className="border border-line bg-bone-raised p-4">
              {/* The legend gives every control in the row its context for
                  assistive tech ("Material 2, Cantidad"). */}
              <fieldset className="min-w-0 border-0 p-0">
                <legend className={cn(LABEL_CLASS, "mb-3 p-0")}>
                  Material {index + 1}
                </legend>

                <div className="grid gap-4 sm:grid-cols-[2fr_1fr_1fr]">
                  <label className={FIELD_CLASS}>
                    <span className={LABEL_CLASS}>Material</span>
                    <select
                      name="itemMaterialId"
                      required
                      value={row.materialId}
                      onChange={(event) =>
                        updateRow(row.key, { materialId: event.target.value })
                      }
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

                  <label className={FIELD_CLASS}>
                    <span className={LABEL_CLASS}>
                      {unit ? `Cantidad (${unit})` : "Cantidad"}
                    </span>
                    <input
                      type="number"
                      name="itemQty"
                      required
                      min="0"
                      step="any"
                      inputMode="decimal"
                      value={row.qty}
                      onChange={(event) =>
                        updateRow(row.key, { qty: event.target.value })
                      }
                      disabled={pending}
                      className={INPUT_CLASS}
                    />
                  </label>

                  <label className={FIELD_CLASS}>
                    <span className={LABEL_CLASS}>Costo total (MXN)</span>
                    <input
                      type="number"
                      name="itemCost"
                      required
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      value={row.cost}
                      onChange={(event) =>
                        updateRow(row.key, { cost: event.target.value })
                      }
                      disabled={pending}
                      className={INPUT_CLASS}
                    />
                  </label>
                </div>

                <button
                  type="button"
                  onClick={() => removeRow(row.key)}
                  disabled={pending || rows.length === 1}
                  aria-label={`Quitar material ${index + 1}`}
                  className={cn(QUIET_BUTTON_CLASS, "mt-2")}
                >
                  Quitar
                </button>
              </fieldset>
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        onClick={addRow}
        disabled={pending || rows.length >= MAX_PURCHASE_ITEMS}
        className={cn(QUIET_BUTTON_CLASS, "self-start")}
      >
        + Agregar otro material
      </button>

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

      <p
        aria-live="polite"
        className="flex flex-wrap items-baseline justify-between gap-2 border-t border-line pt-4"
      >
        <span className={LABEL_CLASS}>Total de la compra</span>
        <span className={cn(NUMBER_CLASS, "text-xl text-ink")}>
          {formatMXN(total)}
        </span>
      </p>

      <FormNotice
        result={result}
        successText="Compra registrada. Las existencias y el costo promedio se actualizaron."
      />

      <button
        type="submit"
        disabled={pending}
        className={cn(PRIMARY_BUTTON_CLASS, "self-start")}
      >
        {pending ? "Registrando…" : "Registrar compra"}
      </button>
    </form>
  );
}
