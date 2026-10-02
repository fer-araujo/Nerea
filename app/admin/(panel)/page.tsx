import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Resumen",
};

// Placeholder until the dashboard modules (calculator, inventory, investments,
// pieces, sales, summary) ship. It reads no data, so the (panel) layout's
// requireAdmin() is all the protection it needs.
export default function AdminSummaryPage() {
  return (
    <section>
      <p className="font-mono text-xs uppercase tracking-[0.14em] text-graphite">
        Panel
      </p>
      <h1 className="mt-3 font-display text-3xl leading-tight text-ink sm:text-4xl">
        Resumen
      </h1>
      <p className="mt-4 max-w-prose text-base leading-relaxed text-graphite">
        Los módulos llegan esta semana.
      </p>
    </section>
  );
}
