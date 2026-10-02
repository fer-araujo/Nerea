"use client";

import { useActionState } from "react";
import { markMessageReadAction, type MarkReadResult } from "./actions";

// A client island ONLY so the Server Action's typed result can be shown next
// to the button; the write itself, and its authorization, stay on the server
// (see actions.ts). On success the page re-renders and this form is replaced
// by the "Leído" label, so only the failure state needs UI.
export function MarkReadForm({ id }: { id: string }) {
  const [result, formAction, pending] = useActionState<
    MarkReadResult | null,
    FormData
  >(markMessageReadAction, null);

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-x-4">
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        disabled={pending}
        className="min-h-11 font-sans text-sm text-graphite underline decoration-line underline-offset-4 transition-colors hover:text-brass-deep disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Marcando…" : "Marcar como leído"}
      </button>
      {!pending && result && !result.ok ? (
        <p role="alert" className="font-mono text-xs text-ink">
          No se pudo actualizar. Intenta de nuevo.
        </p>
      ) : null}
    </form>
  );
}
