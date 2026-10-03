import { useState, useTransition } from "react";
import { failure, type ActionResult } from "@/lib/admin/action-result";

/**
 * Runs an inventory Server Action from a form and tracks its typed result.
 *
 * Forms here submit through this hook instead of `<form action>` /
 * useActionState on purpose: React 19 resets a form's fields after ANY action
 * completes, which would wipe what the admin typed when a validation error
 * comes back. With an explicit submit the fields stay exactly as they were on
 * failure, and the form clears itself (via `onSuccess`) only on success.
 *
 * `useTransition` supplies the pending flag (no hand-rolled loading state),
 * and the action itself is whatever the form passes in — authorization and
 * validation always happen on the server, never here.
 */
export function useAdminAction(
  action: (formData: FormData) => Promise<ActionResult>,
) {
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(form: HTMLFormElement, onSuccess?: () => void) {
    // Read the fields NOW: the event's currentTarget is gone after an await.
    const formData = new FormData(form);
    setResult(null);

    startTransition(async () => {
      try {
        const outcome = await action(formData);
        setResult(outcome);
        if (outcome.ok) {
          onSuccess?.();
        }
      } catch {
        // The action never throws on purpose (it returns typed failures); this
        // is a network drop or a crashed request. Nothing to show but a retry.
        setResult(failure("failed"));
      }
    });
  }

  return { result, pending, submit };
}
