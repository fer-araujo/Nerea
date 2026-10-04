"use client";

import type { FormEvent } from "react";
import { FormNotice } from "@/components/admin/FormNotice";
import { QUIET_BUTTON_CLASS } from "@/components/admin/styles";
import { useAdminAction } from "@/components/admin/useAdminAction";
import { refreshSaleFeeAction } from "./actions";

// "Actualizar comisión" for one online sale whose Stripe fee could not be read
// when the payment came in. A client island ONLY for the pending state and the
// typed result; authorization and the call to Stripe stay on the server (see
// actions.ts). On success the page re-renders and this form is replaced by the
// sale's commission, so only the failure state ("Stripe still has no fee for
// this one, try again later") needs UI.
export function RefreshFeeForm({ saleId }: { saleId: string }) {
  const { result, pending, submit } = useAdminAction(refreshSaleFeeAction);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    submit(event.currentTarget);
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-busy={pending}
      className="flex flex-col items-start gap-1"
    >
      <input type="hidden" name="saleId" value={saleId} />

      <button type="submit" disabled={pending} className={QUIET_BUTTON_CLASS}>
        {pending ? "Consultando a Stripe…" : "Actualizar comisión"}
      </button>

      <FormNotice result={result} successText="Comisión actualizada." />
    </form>
  );
}
