import { AdminShell } from "@/components/admin/AdminShell";
import { requireAdmin } from "@/lib/admin/auth/session";
import { logoutAction } from "./actions";

// Gate for every signed-in admin page: no valid session cookie for an
// allowlisted admin means a redirect to /admin/login. This protects RENDERING
// only — a layout does not guard Server Actions or data reads (a page renders
// in parallel with its layout), so each action and each data-reading page
// calls requireAdmin() itself as well.
export default async function AdminPanelLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdmin();

  return <AdminShell logoutAction={logoutAction}>{children}</AdminShell>;
}
