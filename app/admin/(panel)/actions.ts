"use server";

import { redirect } from "next/navigation";
import { requireAdmin, signOutAdmin } from "@/lib/admin/auth/session";

/**
 * Sign-out Server Action. Like every action under /admin it authorizes
 * itself first — the layout's check does not cover a direct POST. (A caller
 * whose session already lapsed is simply sent to the login page by
 * requireAdmin(), which is where signing out ends up anyway.)
 */
export async function logoutAction(): Promise<void> {
  await requireAdmin();
  await signOutAdmin();
  redirect("/admin/login");
}
