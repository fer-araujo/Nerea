"use client";

import Link from "next/link";
import { useCallback, useRef, useState, type MouseEvent } from "react";
import { ModalDialog } from "@/components/admin/Modal";
import {
  LABEL_CLASS,
  LINK_CLASS,
  NUMBER_CLASS,
  QUIET_BUTTON_CLASS,
} from "@/components/admin/styles";
import { cn } from "@/lib/cn";
import { MATERIAL_KIND_LABELS } from "@/lib/admin/copy";
import type { MaterialKind } from "@/lib/admin/domain/inventory";
import { formatMXN, inventoryValue } from "@/lib/admin/domain/money";
import { formatQuantity, type MaterialUnit } from "@/lib/admin/domain/quantity";
import { AdjustStockForm } from "./AdjustStockForm";
import { CorrectStockForm } from "./CorrectStockForm";
import { PurchaseForm } from "./PurchaseForm";
import { historyHref } from "./links";

export interface InventoryMaterial {
  id: string;
  name: string;
  kind: MaterialKind;
  unit: MaterialUnit;
  stock: number;
  /** Integer centavos per unit. */
  avgCost: number;
}

type RowAction = "purchase" | "adjust" | "correct";

const TH_CLASS = cn(LABEL_CLASS, "px-3 py-3 font-normal first:pl-0 last:pr-0");
const TD_CLASS = "px-3 py-4 align-top first:pl-0 last:pr-0";

// The materials with a row of buttons each. A client island because the three
// dialogs (registrar compra, ajustar, corregir) are SHARED by all the rows: one
// of each for the whole table, opened for the row that was clicked, instead of
// three per row (which would serialize every material again and again). The
// figures are read from Firestore by the page and rendered ONLY as React text
// children (auto-escaped): material names are admin-typed but never trusted as
// HTML. Every write still goes through a Server Action that authorizes and
// validates on its own (see actions.ts).
export function MaterialsTable({
  materials,
  today,
}: {
  materials: InventoryMaterial[];
  /** `YYYY-MM-DD` in Mexico City, computed on the server. */
  today: string;
}) {
  const [active, setActive] = useState<{
    action: RowAction;
    materialId: string;
  } | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const close = useCallback(() => setActive(null), []);

  const selected = active
    ? materials.find((material) => material.id === active.materialId)
    : undefined;
  const isOpen = (action: RowAction) =>
    selected !== undefined && active?.action === action;

  function openFor(
    action: RowAction,
    materialId: string,
    event: MouseEvent<HTMLButtonElement>,
  ) {
    // Remembered explicitly: Safari does not focus a clicked button, so the
    // platform alone cannot know where to return the focus.
    openerRef.current = event.currentTarget;
    setActive({ action, materialId });
  }

  const totalValue = materials.reduce(
    (sum, material) => sum + inventoryValue(material.stock, material.avgCost),
    0,
  );

  return (
    <>
      {/* A scroll region (not a layout squeeze) keeps the columns legible at
          360px; tabIndex lets keyboard users scroll it. */}
      <div
        role="region"
        aria-label="Tabla de materiales"
        tabIndex={0}
        className="overflow-x-auto border-y border-line"
      >
        <table className="w-full min-w-[34rem] border-collapse text-left">
          <caption className="sr-only">
            Materiales con sus existencias, costo promedio por unidad y valor
          </caption>
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className={TH_CLASS}>
                Material
              </th>
              <th scope="col" className={cn(TH_CLASS, "text-right")}>
                Existencias
              </th>
              <th scope="col" className={cn(TH_CLASS, "text-right")}>
                Costo prom. / unidad
              </th>
              <th scope="col" className={cn(TH_CLASS, "text-right")}>
                Valor
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {materials.map((material) => {
              const name = material.name || "Sin nombre";

              return (
                <tr key={material.id}>
                  <th scope="row" className={cn(TD_CLASS, "font-normal")}>
                    <span className="block font-display text-lg leading-snug text-ink [overflow-wrap:anywhere]">
                      {name}
                    </span>
                    <span className={cn(LABEL_CLASS, "mt-1 block")}>
                      {MATERIAL_KIND_LABELS[material.kind]}
                    </span>
                    <span className="mt-1 flex flex-wrap gap-x-5">
                      <button
                        type="button"
                        aria-haspopup="dialog"
                        aria-label={`Registrar compra de ${name}`}
                        onClick={(event) => openFor("purchase", material.id, event)}
                        className={QUIET_BUTTON_CLASS}
                      >
                        Registrar compra
                      </button>
                      <button
                        type="button"
                        aria-haspopup="dialog"
                        aria-label={`Ajustar ${name}`}
                        onClick={(event) => openFor("adjust", material.id, event)}
                        className={QUIET_BUTTON_CLASS}
                      >
                        Ajustar
                      </button>
                      <button
                        type="button"
                        aria-haspopup="dialog"
                        aria-label={`Corregir ${name}`}
                        onClick={(event) => openFor("correct", material.id, event)}
                        className={QUIET_BUTTON_CLASS}
                      >
                        Corregir
                      </button>
                      <Link
                        id={`historial-${material.id}`}
                        href={historyHref(material.id)}
                        scroll={false}
                        aria-label={`Ver historial de ${name}`}
                        className={LINK_CLASS}
                      >
                        Historial
                      </Link>
                    </span>
                  </th>
                  <td className={cn(TD_CLASS, NUMBER_CLASS, "text-right text-ink")}>
                    {formatQuantity(material.stock, material.unit)}
                  </td>
                  <td className={cn(TD_CLASS, NUMBER_CLASS, "text-right text-graphite")}>
                    {formatMXN(material.avgCost)} / {material.unit}
                  </td>
                  <td className={cn(TD_CLASS, NUMBER_CLASS, "text-right text-ink")}>
                    {formatMXN(inventoryValue(material.stock, material.avgCost))}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-ink/30">
              <th
                scope="row"
                colSpan={3}
                className={cn(TD_CLASS, LABEL_CLASS, "font-normal")}
              >
                Valor del inventario
              </th>
              <td className={cn(TD_CLASS, NUMBER_CLASS, "text-right text-ink")}>
                {formatMXN(totalValue)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <ModalDialog
        title="Registrar compra"
        description={selected?.name}
        open={isOpen("purchase")}
        onClose={close}
        returnFocusRef={openerRef}
        size="lg"
      >
        {selected ? (
          <PurchaseForm
            materials={materials.map(({ id, name, unit }) => ({ id, name, unit }))}
            today={today}
            initialMaterialId={selected.id}
          />
        ) : null}
      </ModalDialog>

      <ModalDialog
        title="Ajustar existencias"
        description={selected?.name}
        open={isOpen("adjust")}
        onClose={close}
        returnFocusRef={openerRef}
      >
        {selected ? <AdjustStockForm material={selected} /> : null}
      </ModalDialog>

      <ModalDialog
        title="Corregir existencias y costo"
        description={selected?.name}
        open={isOpen("correct")}
        onClose={close}
        returnFocusRef={openerRef}
      >
        {selected ? <CorrectStockForm material={selected} /> : null}
      </ModalDialog>
    </>
  );
}
