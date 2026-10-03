import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  MonthlyChart,
  type MonthlyChartPoint,
} from "@/components/admin/MonthlyChart";
import { PeriodNav } from "@/components/admin/PeriodNav";
import {
  LABEL_CLASS,
  LINK_CLASS,
  NOTICE_ERROR_CLASS,
  NUMBER_CLASS,
  PANEL_CLASS,
  PRIMARY_BUTTON_CLASS,
} from "@/components/admin/styles";
import { cn } from "@/lib/cn";
import { requireAdmin } from "@/lib/admin/auth/session";
import { periodRangeLabel } from "@/lib/admin/copy";
import {
  CATALOG_LIMIT,
  listCatalog,
  type Catalog,
} from "@/lib/admin/data/catalog";
import { countUnreadMessages } from "@/lib/admin/data/contact-messages";
import {
  MATERIALS_LIMIT,
  listMaterials,
  type Material,
} from "@/lib/admin/data/materials";
import { readSummaryLedger, type SummaryLedger } from "@/lib/admin/data/summary";
import { formatMXN } from "@/lib/admin/domain/money";
import {
  ADMIN_TIME_ZONE,
  DEFAULT_PERIOD,
  parsePeriodKey,
  periodRange,
  type PeriodKey,
  type PeriodRange,
} from "@/lib/admin/domain/periods";
import { formatPercent } from "@/lib/admin/domain/pieces";
import {
  countPieces,
  inventoryTotal,
  ledgerWindow,
  monthlyBuckets,
  periodKpis,
  type MonthBucket,
} from "@/lib/admin/domain/summary";

export const metadata: Metadata = {
  title: "Resumen",
};

const SUMMARY_PATH = "/admin";
const EXPORT_PATH = "/admin/api/export";

// Shown in the atelier's own time no matter where the server runs. Computed
// here, on the server, and handed to the chart as plain strings, so the labels
// can't differ between the server render and the browser.
const AXIS_LABEL_FORMATTER = new Intl.DateTimeFormat("es-MX", {
  month: "short",
  year: "2-digit",
  timeZone: ADMIN_TIME_ZONE,
});
const LONG_LABEL_FORMATTER = new Intl.DateTimeFormat("es-MX", {
  month: "long",
  year: "numeric",
  timeZone: ADMIN_TIME_ZONE,
});

function periodHref(period: PeriodKey): string {
  return period === DEFAULT_PERIOD
    ? SUMMARY_PATH
    : `${SUMMARY_PATH}?period=${period}`;
}

// `null` = Firebase (or Sanity) not configured; a throw = a read failure.
// Either way the page shows a notice instead of crashing the panel.
async function loadLedger(window: PeriodRange): Promise<SummaryLedger | null> {
  try {
    return await readSummaryLedger(window);
  } catch {
    return null;
  }
}

async function loadMaterials(): Promise<Material[] | null> {
  try {
    return await listMaterials();
  } catch {
    return null;
  }
}

async function loadCatalog(): Promise<Catalog | null> {
  try {
    return await listCatalog();
  } catch {
    return null;
  }
}

async function loadUnread(): Promise<number | null> {
  try {
    return await countUnreadMessages();
  } catch {
    return null;
  }
}

function toChartPoints(months: readonly MonthBucket[]): MonthlyChartPoint[] {
  return months.map((month) => ({
    key: month.key,
    label: AXIS_LABEL_FORMATTER.format(month.start),
    longLabel: LONG_LABEL_FORMATTER.format(month.start),
    sales: month.sales,
    investments: month.investments,
    grossProfit: month.grossProfit,
  }));
}

function listWithAnd(items: readonly string[]): string {
  return items.length <= 1
    ? items.join("")
    : `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
}

// A figure built from a read that was cut is PARTIAL, and the page must say so
// instead of presenting it as the whole.
function partialNotes(
  ledger: SummaryLedger | null,
  materials: Material[] | null,
  catalog: Catalog | null,
): string[] {
  const notes: string[] = [];
  if (ledger?.truncated) {
    notes.push(
      "Hay más ventas o compras de las que se pueden leer a la vez: las ventas, la utilidad, las inversiones, el flujo y la gráfica pueden mostrar menos de lo real.",
    );
  }
  // The materials list is cut at its limit without saying so, so reaching the
  // limit is treated as a cut: it can't tell "exactly that many" from "more".
  if (materials && materials.length >= MATERIALS_LIMIT) {
    notes.push(
      `Tienes ${MATERIALS_LIMIT} materiales o más: el valor del inventario puede ser menor al real.`,
    );
  }
  if (catalog?.truncated) {
    notes.push(
      `El catálogo tiene más de ${CATALOG_LIMIT} piezas: los conteos de piezas son parciales.`,
    );
  }
  return notes;
}

function money(centavos: number | null): string {
  return centavos === null ? "—" : formatMXN(centavos);
}

function count(value: number | null): string {
  return value === null ? "—" : String(value);
}

function Hint({ children }: { children: ReactNode }) {
  return (
    <p className="mt-1 font-mono text-xs leading-relaxed text-graphite">
      {children}
    </p>
  );
}

// One figure of the dashboard. `negative` is a LOSS: the garnet color is never
// the only cue (the figure carries its minus sign and the hint says so).
function KpiCard({
  label,
  value,
  negative = false,
  children,
}: {
  label: string;
  value: string;
  negative?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className={PANEL_CLASS}>
      <dt className={LABEL_CLASS}>{label}</dt>
      <dd className="mt-2">
        <p
          className={cn(
            NUMBER_CLASS,
            "text-2xl [overflow-wrap:anywhere]",
            negative ? "text-garnet" : "text-ink",
          )}
        >
          {value}
        </p>
        {children}
      </dd>
    </div>
  );
}

export default async function AdminSummaryPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string | string[] }>;
}) {
  // The (panel) layout guards too, but a page renders in parallel with its
  // layout — so authorize HERE, before anything is read. React cache() inside
  // requireAdmin() makes the second check free within this render. Kept
  // outside any try/catch: a redirect is thrown and must propagate.
  await requireAdmin();

  const { period: rawPeriod } = await searchParams;
  const period = parsePeriodKey(rawPeriod);
  const now = new Date();
  const range = periodRange(period, now);

  // Independent reads, started together. ONE ledger read, over the selected
  // period plus the chart's twelve months, feeds both the cards and the chart.
  const [ledger, materials, catalog, unread] = await Promise.all([
    loadLedger(ledgerWindow(range, now)),
    loadMaterials(),
    loadCatalog(),
    loadUnread(),
  ]);

  const kpis = ledger
    ? periodKpis(ledger.sales, ledger.purchases, range)
    : null;
  const points = ledger
    ? toChartPoints(monthlyBuckets(ledger.sales, ledger.purchases, now))
    : null;
  const inventory = materials ? inventoryTotal(materials) : null;
  const pieces = catalog ? countPieces(catalog.products) : null;

  const failed = [
    ledger === null ? "las ventas y las inversiones" : null,
    materials === null ? "el inventario" : null,
    catalog === null ? "las piezas" : null,
    unread === null ? "los mensajes" : null,
  ].filter((item): item is string => item !== null);
  const partial = partialNotes(ledger, materials, catalog);

  const label = periodRangeLabel(period, range);
  const loss = kpis !== null && kpis.grossProfit < 0;

  return (
    <section>
      <p className={LABEL_CLASS}>Panel</p>
      <h1 className="mt-3 font-display text-3xl leading-tight text-ink sm:text-4xl">
        Resumen
      </h1>
      <p className="mt-4 max-w-prose text-base leading-relaxed text-graphite">
        Cómo va tu taller: lo que vendes, lo que cuesta hacerlo y lo que has
        invertido. Elige un periodo para ver sus cifras; la gráfica siempre
        muestra los últimos 12 meses.
      </p>

      <PeriodNav current={period} hrefFor={periodHref} className="mt-10" />

      {failed.length > 0 ? (
        <p role="alert" className={cn(NOTICE_ERROR_CLASS, "mt-6")}>
          No pudimos cargar {listWithAnd(failed)}. Recarga la página e
          inténtalo de nuevo.
        </p>
      ) : null}

      {partial.length > 0 ? (
        <div role="status" className={cn(NOTICE_ERROR_CLASS, "mt-6")}>
          <p className="uppercase tracking-[0.14em]">Datos parciales</p>
          <ul className="mt-2 list-disc space-y-1 pl-4">
            {partial.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <section aria-labelledby="cifras-titulo" className="mt-10">
        <h2
          id="cifras-titulo"
          className="font-display text-2xl leading-tight text-ink"
        >
          Cifras de {label}
        </h2>

        <dl className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <KpiCard label="Ventas" value={money(kpis?.sales ?? null)}>
            {kpis ? (
              <Hint>
                {kpis.salesCount} {kpis.salesCount === 1 ? "venta" : "ventas"}
              </Hint>
            ) : null}
          </KpiCard>

          <KpiCard
            label="Costo de lo vendido"
            value={money(kpis?.costOfGoods ?? null)}
          >
            <Hint>Lo que costó hacer las piezas vendidas</Hint>
          </KpiCard>

          <KpiCard
            label="Utilidad bruta"
            value={money(kpis?.grossProfit ?? null)}
            negative={loss}
          >
            {kpis ? (
              <Hint>
                Margen{" "}
                {kpis.marginPercent === null
                  ? "—"
                  : formatPercent(kpis.marginPercent)}
                {loss ? " · En pérdida" : ""}
              </Hint>
            ) : null}
          </KpiCard>

          <KpiCard
            label="Inversiones"
            value={money(kpis?.investments ?? null)}
          >
            {kpis ? (
              <Hint>
                {kpis.purchaseCount}{" "}
                {kpis.purchaseCount === 1 ? "compra" : "compras"}
              </Hint>
            ) : null}
          </KpiCard>

          <KpiCard label="Flujo" value={money(kpis?.cashFlow ?? null)}>
            <Hint>Ventas menos inversiones</Hint>
          </KpiCard>

          <KpiCard label="Valor del inventario" value={money(inventory)}>
            <Hint>Materiales en existencia, a costo promedio</Hint>
          </KpiCard>

          <KpiCard
            label="Piezas disponibles / vendidas"
            value={pieces ? `${pieces.available} / ${pieces.sold}` : "—"}
          >
            <Hint>En el catálogo</Hint>
          </KpiCard>

          <KpiCard label="Mensajes sin leer" value={count(unread)}>
            <Link href="/admin/mensajes" className={cn(LINK_CLASS, "mt-1")}>
              Ver mensajes
            </Link>
          </KpiCard>

          <KpiCard
            label="Ventas con costo pendiente"
            value={count(kpis?.pendingCostCount ?? null)}
          >
            {kpis && kpis.pendingCostCount > 0 ? (
              <Hint>La utilidad bruta de esas ventas es mayor que la real.</Hint>
            ) : null}
            <Link href="/admin/piezas" className={cn(LINK_CLASS, "mt-1")}>
              Registrar costos
            </Link>
          </KpiCard>
        </dl>

        <p className="mt-4 max-w-prose text-sm leading-relaxed text-graphite">
          La utilidad bruta es lo que queda de tus ventas después de restar lo
          que costó hacer las piezas que vendiste. El flujo es lo que vendiste
          menos lo que invertiste en materiales en el mismo periodo, aunque ese
          material siga en tu inventario. Las ventas son el precio de las
          piezas, sin el envío.
        </p>
      </section>

      <section aria-labelledby="meses-titulo" className="mt-14">
        <h2
          id="meses-titulo"
          className="font-display text-2xl leading-tight text-ink"
        >
          Mes a mes
        </h2>
        <div className={cn(PANEL_CLASS, "mt-6")}>
          {points === null ? (
            <p className="text-sm text-graphite">
              No pudimos calcular la gráfica.
            </p>
          ) : (
            <MonthlyChart points={points} />
          )}
        </div>
      </section>

      <section aria-labelledby="respaldo-titulo" className="mt-14">
        <h2
          id="respaldo-titulo"
          className="font-display text-2xl leading-tight text-ink"
        >
          Respaldo
        </h2>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-graphite">
          Descarga una copia de todo lo que guarda el panel: materiales y sus
          movimientos, inversiones, vaciados, piezas, ventas, mensajes y el
          registro de cambios.
        </p>
        {/* A plain link, not next/link: it is a download, not a page, so it
            must not be prefetched or routed on the client. */}
        <a href={EXPORT_PATH} className={cn(PRIMARY_BUTTON_CLASS, "mt-5")}>
          Descargar respaldo
        </a>
        <p className="mt-3 font-mono text-xs leading-relaxed text-graphite">
          Contiene datos personales; guárdalo en un lugar seguro.
        </p>
      </section>
    </section>
  );
}
