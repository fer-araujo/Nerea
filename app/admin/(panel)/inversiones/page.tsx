import type { Metadata } from "next";
import Link from "next/link";
import { Pager } from "@/components/admin/Pager";
import {
  LABEL_CLASS,
  LINK_CLASS,
  NOTICE_ERROR_CLASS,
  NOTICE_INFO_CLASS,
  NUMBER_CLASS,
  PANEL_CLASS,
} from "@/components/admin/styles";
import { cn } from "@/lib/cn";
import { requireAdmin } from "@/lib/admin/auth/session";
import { listMaterials, type Material } from "@/lib/admin/data/materials";
import {
  PURCHASE_SUM_LIMIT,
  listPurchases,
  sumPurchases,
  type Purchase,
  type PurchasePage,
  type PurchaseTotal,
} from "@/lib/admin/data/purchases";
import { formatMXN } from "@/lib/admin/domain/money";
import {
  ADMIN_TIME_ZONE,
  DEFAULT_PERIOD,
  mexicoTodayIso,
  parsePeriodKey,
  periodRange,
  type PeriodKey,
  type PeriodRange,
} from "@/lib/admin/domain/periods";
import { formatQuantity } from "@/lib/admin/domain/quantity";
import { parsePageParam } from "@/lib/admin/pagination";
import { PurchaseForm } from "./PurchaseForm";

export const metadata: Metadata = {
  title: "Inversiones",
};

const INVESTMENTS_PATH = "/admin/inversiones";

const PERIOD_LINKS: ReadonlyArray<{ key: PeriodKey; label: string }> = [
  { key: "this-month", label: "Este mes" },
  { key: "last-month", label: "Mes anterior" },
  { key: "this-year", label: "Este año" },
];

// Shown in the atelier's own time no matter where the server runs.
const DATE_FORMATTER = new Intl.DateTimeFormat("es-MX", {
  dateStyle: "medium",
  timeZone: ADMIN_TIME_ZONE,
});
const MONTH_FORMATTER = new Intl.DateTimeFormat("es-MX", {
  month: "long",
  year: "numeric",
  timeZone: ADMIN_TIME_ZONE,
});
const YEAR_FORMATTER = new Intl.DateTimeFormat("es-MX", {
  year: "numeric",
  timeZone: ADMIN_TIME_ZONE,
});

function listHref(period: PeriodKey, page: number): string {
  const params = new URLSearchParams();
  if (period !== DEFAULT_PERIOD) {
    params.set("period", period);
  }
  if (page > 1) {
    params.set("page", String(page));
  }
  const query = params.toString();
  return query ? `${INVESTMENTS_PATH}?${query}` : INVESTMENTS_PATH;
}

function rangeLabel(key: PeriodKey, range: PeriodRange): string {
  return key === "this-year"
    ? YEAR_FORMATTER.format(range.start)
    : MONTH_FORMATTER.format(range.start);
}

// `null` = Firebase not configured; a throw = Firestore failure. Either way
// the page shows a notice instead of crashing the panel.
async function loadPurchases(
  range: PeriodRange,
  page: number,
): Promise<PurchasePage | null> {
  try {
    return await listPurchases(range, page);
  } catch {
    return null;
  }
}

async function loadTotal(range: PeriodRange): Promise<PurchaseTotal | null> {
  try {
    return await sumPurchases(range);
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

function LoadError({ children }: { children: string }) {
  return (
    <p role="alert" className={NOTICE_ERROR_CLASS}>
      {children}
    </p>
  );
}

// Supplier, note and material names are admin-typed: rendered ONLY as React
// text children (auto-escaped), never as HTML.
function PurchaseItem({
  purchase,
  units,
}: {
  purchase: Purchase;
  units: Map<string, Material["unit"]>;
}) {
  return (
    <li className="py-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="font-display text-lg leading-snug text-ink [overflow-wrap:anywhere]">
          {purchase.supplier ?? "Compra"}
        </h3>
        <span className={cn(NUMBER_CLASS, "text-base text-ink")}>
          {formatMXN(purchase.totalCost)}
        </span>
      </div>

      {purchase.date ? (
        <time
          dateTime={purchase.date.toISOString()}
          className="mt-1 block font-mono text-xs text-graphite"
        >
          {DATE_FORMATTER.format(purchase.date)}
        </time>
      ) : null}

      <ul className="mt-3 flex flex-col gap-1">
        {purchase.items.map((item, index) => (
          <li
            key={`${item.materialId}-${index}`}
            className="flex items-baseline justify-between gap-4 text-sm text-graphite"
          >
            <span className="[overflow-wrap:anywhere]">
              {item.materialName || "Material"} ·{" "}
              {formatQuantity(item.qty, units.get(item.materialId) ?? "g")}
            </span>
            <span className={cn(NUMBER_CLASS, "shrink-0")}>
              {formatMXN(item.totalCost)}
            </span>
          </li>
        ))}
      </ul>

      {purchase.note ? (
        <p className="mt-3 max-w-prose text-sm leading-relaxed text-graphite [overflow-wrap:anywhere]">
          {purchase.note}
        </p>
      ) : null}
    </li>
  );
}

export default async function AdminInvestmentsPage({
  searchParams,
}: {
  searchParams: Promise<{
    period?: string | string[];
    page?: string | string[];
  }>;
}) {
  // The (panel) layout guards too, but a page renders in parallel with its
  // layout — so authorize HERE, before Firestore is touched. React cache()
  // inside requireAdmin() makes the second check free within this render.
  // Kept outside any try/catch: a redirect is thrown and must propagate.
  await requireAdmin();

  const { period: rawPeriod, page: rawPage } = await searchParams;
  const period = parsePeriodKey(rawPeriod);
  const page = parsePageParam(rawPage);
  const range = periodRange(period);

  // Independent reads, started together.
  const [list, total, materials] = await Promise.all([
    loadPurchases(range, page),
    loadTotal(range),
    loadMaterials(),
  ]);

  const units = new Map(
    (materials ?? []).map((material) => [material.id, material.unit] as const),
  );
  const label = rangeLabel(period, range);

  return (
    <section>
      <p className={LABEL_CLASS}>Panel</p>
      <h1 className="mt-3 font-display text-3xl leading-tight text-ink sm:text-4xl">
        Inversiones
      </h1>
      <p className="mt-4 max-w-prose text-base leading-relaxed text-graphite">
        Lo que compras de metales, ligas y piedras. Cada compra suma a las
        existencias y recalcula el costo promedio de cada material.
      </p>

      <nav
        aria-label="Periodo"
        className="mt-10 flex gap-6 overflow-x-auto border-b border-line"
      >
        {PERIOD_LINKS.map((item) => (
          <Link
            key={item.key}
            href={listHref(item.key, 1)}
            aria-current={item.key === period ? "page" : undefined}
            className={cn(
              "-mb-px inline-flex min-h-11 shrink-0 items-center border-b-2 font-sans text-sm transition-colors",
              item.key === period
                ? "border-brass text-ink"
                : "border-transparent text-graphite hover:text-ink",
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <div className={cn(PANEL_CLASS, "mt-8")}>
        <p className={LABEL_CLASS}>Total invertido · {label}</p>
        {total === null ? (
          <p className="mt-3 text-sm text-graphite">
            No pudimos calcular el total.
          </p>
        ) : (
          <>
            <p className={cn(NUMBER_CLASS, "mt-2 text-3xl text-ink sm:text-4xl")}>
              {formatMXN(total.totalCost)}
            </p>
            <p className="mt-1 font-mono text-xs text-graphite">
              {total.count} {total.count === 1 ? "compra" : "compras"}
            </p>
            {total.truncated ? (
              <p role="status" className={cn(NOTICE_INFO_CLASS, "mt-4")}>
                Este periodo tiene más de {PURCHASE_SUM_LIMIT} compras: el total
                es parcial.
              </p>
            ) : null}
          </>
        )}
      </div>

      <div className="mt-10">
        {list === null ? (
          <LoadError>
            No pudimos cargar las compras. Recarga la página e inténtalo de
            nuevo.
          </LoadError>
        ) : list.purchases.length === 0 ? (
          <div className="border border-line bg-bone-raised px-6 py-10">
            <p className="font-display text-xl text-ink">
              {page > 1 ? "No hay más compras" : "Sin compras en este periodo"}
            </p>
            <p className="mt-2 text-graphite">
              {page > 1
                ? "Esta página ya no tiene compras."
                : "Cuando registres una compra, aparecerá aquí."}
            </p>
            {page > 1 ? (
              <Link
                href={listHref(period, 1)}
                className={cn(LINK_CLASS, "mt-3")}
              >
                Ir a las más recientes
              </Link>
            ) : null}
          </div>
        ) : (
          <>
            <ul className="divide-y divide-line border-y border-line">
              {list.purchases.map((purchase) => (
                <PurchaseItem key={purchase.id} purchase={purchase} units={units} />
              ))}
            </ul>
            <Pager
              page={page}
              hasNextPage={list.hasNextPage}
              hrefFor={(target) => listHref(period, target)}
              label="Paginación de compras"
            />
          </>
        )}
      </div>

      <section aria-labelledby="registrar-compra" className="mt-14">
        <h2
          id="registrar-compra"
          className="font-display text-2xl leading-tight text-ink"
        >
          Registrar compra
        </h2>
        <div className="mt-6">
          {materials === null ? (
            <LoadError>
              No pudimos cargar tus materiales. Recarga la página e inténtalo
              de nuevo.
            </LoadError>
          ) : materials.length === 0 ? (
            <p className="max-w-prose text-sm leading-relaxed text-graphite">
              Primero crea tus materiales en{" "}
              <Link href="/admin/inventario" className={LINK_CLASS}>
                Inventario
              </Link>
              ; después podrás registrar aquí su compra, incluido tu inventario
              inicial.
            </p>
          ) : (
            <PurchaseForm
              today={mexicoTodayIso()}
              materials={materials.map(({ id, name, unit }) => ({
                id,
                name,
                unit,
              }))}
            />
          )}
        </div>
      </section>
    </section>
  );
}
