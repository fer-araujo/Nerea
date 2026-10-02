import type { ReactNode } from "react";
import { Logo } from "@/components/brand/Logo";
import { AdminNav } from "./AdminNav";

// Chrome for the signed-in panel: a quiet header (brand, section tabs, sign
// out) over a single content column. Same tokens and type roles as the
// storefront — hairlines instead of shadows, mono uppercase for labels, the
// display serif for headings — and a 44px minimum touch target on every
// control so it holds up from 360px phones to desktop.
//
// `logoutAction` is injected by the (panel) layout rather than imported here:
// a Server Action lives next to the routes that own it, and this component
// stays free of any app/ dependency.
export function AdminShell({
  children,
  logoutAction,
}: {
  children: ReactNode;
  logoutAction: () => Promise<void>;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-line bg-bone-raised">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:px-8">
          <div className="flex items-center gap-3">
            <Logo variant="lockup" className="text-xl text-ink" />
            <span className="border-l border-line pl-3 font-mono text-[11px] uppercase tracking-[0.14em] text-graphite">
              Panel
            </span>
          </div>

          <form action={logoutAction}>
            <button
              type="submit"
              className="min-h-11 font-mono text-xs uppercase tracking-[0.14em] text-graphite transition-colors hover:text-brass-deep"
            >
              Cerrar sesión
            </button>
          </form>
        </div>

        <div className="mx-auto w-full max-w-5xl px-4 sm:px-8">
          <AdminNav />
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 sm:px-8 sm:py-14">
        {children}
      </main>
    </div>
  );
}
