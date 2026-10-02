"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin/auth/session";
import { markContactMessageRead } from "@/lib/admin/data/contact-messages";

// One generic failure on purpose: the UI has a single "try again" message, and
// the browser has no use for Firestore internals (or for telling "malformed
// id" apart from "database down").
export type MarkReadResult = { ok: true } | { ok: false; error: "failed" };

/**
 * "Marcar como leído". A Server Action is a public POST endpoint — the
 * (panel) layout's check does not run for it — so it authorizes itself
 * FIRST, before reading the form or touching Firestore. Not an admin means
 * requireAdmin() redirects (it throws), and nothing below ever executes.
 *
 * Shaped for React's `useActionState` (previous state first, then the
 * FormData) so MarkReadForm can show the typed result inline. Failures are
 * returned, not swallowed: the message stays "Nuevo" AND the admin is told
 * the update did not happen.
 *
 * The id comes from a hidden input, i.e. from the request: it is treated as
 * untrusted and validated again inside markContactMessageRead().
 */
export async function markMessageReadAction(
  _previous: MarkReadResult | null,
  formData: FormData,
): Promise<MarkReadResult> {
  await requireAdmin();

  const id = formData.get("id");
  if (typeof id !== "string") {
    return { ok: false, error: "failed" };
  }

  try {
    // `false` = malformed id or Firebase not configured; a throw = the
    // document is gone or Firestore failed. Not logged — it could carry
    // message content.
    if (!(await markContactMessageRead(id))) {
      return { ok: false, error: "failed" };
    }
  } catch {
    return { ok: false, error: "failed" };
  }

  revalidatePath("/admin/mensajes");
  return { ok: true };
}
