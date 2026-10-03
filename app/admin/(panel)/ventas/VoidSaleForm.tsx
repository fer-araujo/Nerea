"use client";

import { useState, type FormEvent } from "react";
import { FormNotice } from "@/components/admin/FormNotice";
import { QUIET_BUTTON_CLASS } from "@/components/admin/styles";
import { useAdminAction } from "@/components/admin/useAdminAction";
import { voidSaleAction } from "./actions";

// "Anular venta" for one manual sale, behind a confirmation: voiding cannot be
// undone from here. A client island ONLY for that confirmation and the typed
// result; authorization and the write stay on the server (see actions.ts). On
// success the page re-renders and this form is replaced by the muted "Anulada"
// row, so only the failure state needs UI.
export function VoidSaleForm({ saleId }: { saleId: string }) {
  const { result, pending, submit } = useAdminAction(voidSaleAction);
  const [confirming, setConfirming] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    submit(event.currentTarget, () => setConfirming(false));
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-busy={pending}
      className="flex flex-col items-start gap-1"
    >
      <input type="hidden" name="saleId" value={saleId} />

      {confirming ? (
        <>
          <p className="max-w-prose text-sm leading-relaxed text-graphite">
            La venta se queda en el historial pero deja de contar en los
            totales. La pieza no vuelve a la tienda: eso se hace en Studio.
          </p>
          <div className="flex flex-wrap items-center gap-x-4">
            <button
              type="submit"
              disabled={pending}
              className={QUIET_BUTTON_CLASS}
            >
              {pending ? "Anulando…" : "Sí, anular venta"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={pending}
              className={QUIET_BUTTON_CLASS}
            >
              Cancelar
            </button>
          </div>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className={QUIET_BUTTON_CLASS}
        >
          Anular venta
        </button>
      )}

      <FormNotice result={result} successText="Venta anulada." />
    </form>
  );
}
