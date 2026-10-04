"use client";

import { useId, useRef, useState, type FormEvent } from "react";
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
import {
  centavosToPesosText,
  formatMXN,
  pesosToCentavos,
} from "@/lib/admin/domain/money";
import { MAX_SALE_ITEMS } from "@/lib/admin/domain/sales";
import { recordManualSaleAction } from "./actions";

/** A piece that is still available to sell. */
export interface SalePiece {
  handle: string;
  title: string;
  /** The catalog price, integer centavos: the form's starting price. */
  price: number;
}

interface Row {
  /** Stable React key; never reused while the row exists. */
  key: number;
  handle: string;
  price: string;
  option: string;
}

const MONEY_PATTERN = /^\d{1,8}(?:\.\d{1,2})?$/;

function emptyRow(key: number): Row {
  return { key, handle: "", price: "", option: "" };
}

/** What the live total counts: only an amount that is already valid. */
function toCentavos(text: string): number {
  const trimmed = text.trim();
  return MONEY_PATTERN.test(trimmed) ? pesosToCentavos(Number(trimmed)) : 0;
}

// Records a sale made outside the online shop. A client island ONLY for the
// piece rows (each starts at the catalog price, editable for a discount), the
// live total and the typed result — the server action authorizes, validates
// every field again, takes titles and availability from the catalog and does
// the real write (see actions.ts). The total shown here is a convenience,
// never what gets stored.
export function ManualSaleForm({
  pieces,
  today,
}: {
  pieces: SalePiece[];
  /** `YYYY-MM-DD` in Mexico City, computed on the server. */
  today: string;
}) {
  const { result, pending, submit } = useAdminAction(recordManualSaleAction);
  const markSoldHintId = useId();
  const noteHintId = useId();
  const terminalFeeHintId = useId();
  const nextKey = useRef(1);
  const [rows, setRows] = useState<Row[]>(() => [emptyRow(0)]);
  const [date, setDate] = useState(today);
  const [shipping, setShipping] = useState("");
  const [terminalFee, setTerminalFee] = useState("");
  const [note, setNote] = useState("");
  const [markSold, setMarkSold] = useState(true);

  const maxRows = Math.min(MAX_SALE_ITEMS, pieces.length);
  const subtotal = rows.reduce((sum, row) => sum + toCentavos(row.price), 0);
  const total = subtotal + toCentavos(shipping);

  function updateRow(key: number, patch: Partial<Omit<Row, "key">>) {
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
  }

  // Choosing a piece starts the price at the catalog's; the admin may lower it.
  function choosePiece(key: number, handle: string) {
    const piece = pieces.find((candidate) => candidate.handle === handle);
    updateRow(key, {
      handle,
      price: piece ? centavosToPesosText(piece.price) : "",
    });
  }

  function addRow() {
    const key = nextKey.current;
    nextKey.current += 1;
    setRows((current) =>
      current.length < maxRows ? [...current, emptyRow(key)] : current,
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
      setShipping("");
      setTerminalFee("");
      setNote("");
      setMarkSold(true);
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-busy={pending}
      className="flex flex-col gap-6"
    >
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

        <label className={FIELD_CLASS}>
          <span className={LABEL_CLASS}>Envío cobrado (MXN, opcional)</span>
          <input
            type="number"
            name="shipping"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={shipping}
            onChange={(event) => setShipping(event.target.value)}
            disabled={pending}
            className={INPUT_CLASS}
          />
        </label>

        <div className={FIELD_CLASS}>
          <label className={FIELD_CLASS}>
            <span className={LABEL_CLASS}>Comisión (terminal, MXN, opcional)</span>
            <input
              type="number"
              name="terminalFee"
              min="0"
              step="0.01"
              inputMode="decimal"
              aria-describedby={terminalFeeHintId}
              value={terminalFee}
              onChange={(event) => setTerminalFee(event.target.value)}
              disabled={pending}
              className={INPUT_CLASS}
            />
          </label>
          <p id={terminalFeeHintId} className="text-sm leading-relaxed text-graphite">
            Lo que cobró la terminal por esta venta, con el IVA de la comisión.
            Déjalo vacío si cobraste en efectivo.
          </p>
        </div>
      </div>

      <ul className="flex flex-col gap-4">
        {rows.map((row, index) => {
          // A piece can only be sold once, so the ones chosen in OTHER rows
          // are not offered here.
          const takenElsewhere = new Set(
            rows
              .filter((other) => other.key !== row.key && other.handle !== "")
              .map((other) => other.handle),
          );

          return (
            <li key={row.key} className="border border-line bg-bone-raised p-4">
              {/* The legend gives every control in the row its context for
                  assistive tech ("Pieza 2, Precio"). */}
              <fieldset className="min-w-0 border-0 p-0">
                <legend className={cn(LABEL_CLASS, "mb-3 p-0")}>
                  Pieza {index + 1}
                </legend>

                <div className="grid gap-4 sm:grid-cols-[2fr_1fr_1fr]">
                  <label className={FIELD_CLASS}>
                    <span className={LABEL_CLASS}>Pieza</span>
                    <select
                      name="itemHandle"
                      required
                      value={row.handle}
                      onChange={(event) =>
                        choosePiece(row.key, event.target.value)
                      }
                      disabled={pending}
                      className={SELECT_CLASS}
                    >
                      <option value="">Elige una pieza</option>
                      {pieces
                        .filter((piece) => !takenElsewhere.has(piece.handle))
                        .map((piece) => (
                          <option key={piece.handle} value={piece.handle}>
                            {piece.title || piece.handle}
                          </option>
                        ))}
                    </select>
                  </label>

                  <label className={FIELD_CLASS}>
                    <span className={LABEL_CLASS}>Precio (MXN)</span>
                    <input
                      type="number"
                      name="itemPrice"
                      required
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      value={row.price}
                      onChange={(event) =>
                        updateRow(row.key, { price: event.target.value })
                      }
                      disabled={pending}
                      className={INPUT_CLASS}
                    />
                  </label>

                  <label className={FIELD_CLASS}>
                    <span className={LABEL_CLASS}>Opción (opcional)</span>
                    <input
                      type="text"
                      name="itemOption"
                      maxLength={60}
                      autoComplete="off"
                      placeholder="Talla 7"
                      value={row.option}
                      onChange={(event) =>
                        updateRow(row.key, { option: event.target.value })
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
                  aria-label={`Quitar pieza ${index + 1}`}
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
        disabled={pending || rows.length >= maxRows}
        className={cn(QUIET_BUTTON_CLASS, "self-start")}
      >
        + Agregar otra pieza
      </button>

      <div className={FIELD_CLASS}>
        <label className={FIELD_CLASS}>
          <span className={LABEL_CLASS}>Nota (opcional)</span>
          <input
            type="text"
            name="note"
            maxLength={300}
            autoComplete="off"
            aria-describedby={noteHintId}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            disabled={pending}
            className={INPUT_CLASS}
          />
        </label>
        <p id={noteHintId} className="text-sm text-graphite">
          No escribas datos personales de la clienta o el cliente.
        </p>
      </div>

      <div className="flex flex-col gap-1">
        <label className="flex min-h-11 items-center gap-3 font-sans text-sm text-ink">
          <input
            type="checkbox"
            name="markSold"
            checked={markSold}
            onChange={(event) => setMarkSold(event.target.checked)}
            aria-describedby={markSoldHintId}
            disabled={pending}
            className="size-5 shrink-0 accent-ink"
          />
          Marcar como vendida en la tienda
        </label>
        <p id={markSoldHintId} className="text-sm leading-relaxed text-graphite">
          Quita la pieza de la tienda en línea para que nadie más la compre.
        </p>
      </div>

      <div
        aria-live="polite"
        className="flex flex-col gap-2 border-t border-line pt-4"
      >
        <p className="flex flex-wrap items-baseline justify-between gap-2">
          <span className={LABEL_CLASS}>Piezas</span>
          <span className={cn(NUMBER_CLASS, "text-base text-ink")}>
            {formatMXN(subtotal)}
          </span>
        </p>
        <p className="flex flex-wrap items-baseline justify-between gap-2">
          <span className={LABEL_CLASS}>Total de la venta</span>
          <span className={cn(NUMBER_CLASS, "text-xl text-ink")}>
            {formatMXN(total)}
          </span>
        </p>
      </div>

      <FormNotice result={result} successText="Venta registrada." />

      <button
        type="submit"
        disabled={pending}
        className={cn(PRIMARY_BUTTON_CLASS, "self-start")}
      >
        {pending ? "Registrando…" : "Registrar venta"}
      </button>
    </form>
  );
}
