import { getAdminOrNull } from "@/lib/admin/auth/session";
import { readBackup, type Backup } from "@/lib/admin/data/backup";
import { backupFilename } from "@/lib/admin/domain/backup";

// firebase-admin needs Node, never the Edge runtime.
export const runtime = "nodejs";
// Never cached or prerendered: it is the live data of a signed-in admin.
export const dynamic = "force-dynamic";

// `no-store` on every answer, errors included: neither the backup nor the
// fact that someone asked for it may sit in a shared cache. `nosniff` keeps a
// browser from second-guessing the type.
const BASE_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
} as const;

// The error body is a fixed code: nothing from the session, the database or an
// exception ever reaches the response.
function failure(error: string, status: number): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: BASE_HEADERS,
  });
}

// "Descargar respaldo": every collection as one JSON file. The file holds
// visitors' personal data (the contact inbox), so this is the admin and nobody
// else — checked HERE, because a route handler sits outside the (panel)
// layout's gate and the middleware does not run on /admin. The session cookie
// is SameSite=Strict and scoped to /admin, so another site cannot make the
// browser send it on a cross-site request either.
//
// No code path logs a document, a count or an error message.
export async function GET(): Promise<Response> {
  const admin = await getAdminOrNull();
  if (!admin) {
    return failure("unauthorized", 401);
  }

  let backup: Backup | null;
  try {
    backup = await readBackup();
  } catch {
    console.error("[admin] The backup could not be read.");
    return failure("export-failed", 500);
  }
  if (!backup) {
    return failure("not-configured", 503);
  }

  return new Response(JSON.stringify(backup), {
    status: 200,
    headers: {
      ...BASE_HEADERS,
      // Always a download, never rendered in the tab.
      "Content-Disposition": `attachment; filename="${backupFilename()}"`,
    },
  });
}
