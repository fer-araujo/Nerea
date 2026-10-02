import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Logo } from "@/components/brand/Logo";
import { getAdminOrNull } from "@/lib/admin/auth/session";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = {
  title: "Acceso",
};

// Deliberately OUTSIDE the (panel) route group: that group's layout calls
// requireAdmin() and redirects here, so guarding this page the same way would
// loop. An already-signed-in admin is sent on to the panel instead of being
// shown a form they don't need.
export default async function AdminLoginPage() {
  if (await getAdminOrNull()) {
    redirect("/admin");
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-16 sm:px-8">
      <Logo variant="lockup" className="text-2xl text-ink" />

      <p className="mt-12 font-mono text-xs uppercase tracking-[0.14em] text-graphite">
        Panel
      </p>
      <h1 className="mt-3 font-display text-3xl leading-tight text-ink sm:text-4xl">
        Acceso
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-graphite">
        Solo para la administración del atelier.
      </p>

      <div className="mt-10">
        <LoginForm />
      </div>
    </main>
  );
}
