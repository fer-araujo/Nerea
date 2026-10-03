import type { Metadata } from "next";
import Link from "next/link";
import { Pager } from "@/components/admin/Pager";
import {
  BADGE_ATTENTION_CLASS,
  BADGE_CLASS,
  LABEL_CLASS,
  LINK_CLASS,
  NOTICE_ERROR_CLASS,
  NOTICE_INFO_CLASS,
  NUMBER_CLASS,
  PANEL_CLASS,
} from "@/components/admin/styles";
import { cn } from "@/lib/cn";
import { requireAdmin } from "@/lib/admin/auth/session";
import { SALE_SOURCE_LABELS } from "@/lib/admin/copy";
import { listCatalog, type Catalog } from "@/lib/admin/data/catalog";
import {
  SALES_SUM_LIMIT,
  listSales,
  sumSales,
  type Sale,
  type SalePage,
  type SalesPeriodTotal,
} from "@/lib/admin/data/sales";
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
import { parsePageParam } from "@/lib/admin/pagination";
import { ManualSaleForm, type SalePiece } from "./ManualSaleForm";
import { VoidSaleForm } from "./VoidSaleForm";

export const metadata: Metadata = {
  title: "Ventas",
};

const SALES_PATH = "/admin/ventas";

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
  return query ? `${SALES_PATH}?${query}` : SALES_PATH;
}

function rangeLabel(key: PeriodKey, range: PeriodRange): string {
  return key === "this-year"
    ? YEAR_FORMATTER.format(range.start)
    : MONTH_FORMATTER.format(range.start);
}

// `null` = Firebase (or Sanity) not configured; a throw = a read failure.
// Either way the page shows a notice instead of crashing the panel.
async function loadSales(
  range: PeriodRange,
  page: number,
): Promise<SalePage | null> {
  try {
    return await listSales(range, page);
  } catch {
    return null;
  }
}

async function loadTotal(range: PeriodRange): Promise<SalesPeriodTotal | null> {
  try {
    return await sumSales(range);
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

function LoadError({ children }: { children: string }) {
  return (
    <p role="alert" className={NOTICE_ERROR_CLASS}>
      {children}
    </p>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className={LABEL_CLASS}>{label}</dt>
      <dd className={cn(NUMBER_CLASS, "text-xl text-ink")}>{value}</dd>
    </div>
  );
}

function saleHeadline(sale: Sale): string {
  const [first] = sale.items;
  if (!first) {
    return "Venta";
  }
  const name = first.title || first.handle || "Pieza";
  return sale.items.length === 1
    ? name
    : `${name} + ${sale.items.length - 1} más`;
}

// Titles, options and notes are admin-typed (or come from the catalog):
// rendered ONLY as React text children (auto-escaped), never as HTML. A sale
// holds no customer data, so there is none to show.
function SaleRow({ sale }: { sale: Sale }) {
  const voided = sale.status === "void";

  return (
    // A voided sale stays on the list, muted: it is history, and it no longer
    // counts. The "Anulada" badge carries the meaning, not the dimming.
    <li className={cn("py-5", voided ? "opacity-60" : null)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="font-display text-lg leading-snug text-ink [overflow-wrap:anywhere]">
          {saleHeadline(sale)}
        </h3>
        <span
          className={cn(
            NUMBER_CLASS,
            "text-base text-ink",
            voided ? "line-through" : null,
          )}
        >
          {formatMXN(sale.total)}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className={BADGE_CLASS}>{SALE_SOURCE_LABELS[sale.source]}</span>
        {voided ? <span className={BADGE_CLASS}>Anulada</span> : null}
        {sale.costPending ? (
          <span className={BADGE_ATTENTION_CLASS}>Costo pendiente</span>
        ) : null}
      </div>

      {sale.date ? (
        <time
          dateTime={sale.date.toISOString()}
          className="mt-2 block font-mono text-xs text-graphite"
        >
          {DATE_FORMATTER.format(sale.date)}
        </time>
      ) : null}

      <ul className="mt-3 flex flex-col gap-1">
        {sale.items.map((item, index) => (
          <li
            key={`${item.handle}-${index}`}
            className="flex items-baseline justify-between gap-4 text-sm text-graphite"
          >
            <span className="[overflow-wrap:anywhere]">
              {item.title || item.handle || "Pieza"}
              {item.option ? ` · ${item.option}` : ""}
            </span>
            <span className={cn(NUMBER_CLASS, "shrink-0")}>
              {formatMXN(item.price)}
            </span>
          </li>
        ))}
      </ul>

      <p
        className={cn(
          NUMBER_CLASS,
          "mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-graphite",
        )}
      >
        <span>Envío {formatMXN(sale.shipping)}</span>
        <span>Costo {formatMXN(sale.costOfGoods)}</span>
        <span>Utilidad {formatMXN(sale.subtotal - sale.costOfGoods)}</span>
      </p>

      {sale.note ? (
        <p className="mt-3 max-w-prose text-sm leading-relaxed text-graphite [overflow-wrap:anywhere]">
          {sale.note}
        </p>
      ) : null}

      {sale.source === "manual" && !voided ? (
        <div className="mt-2">
          <VoidSaleForm saleId={sale.id} />
        </div>
      ) : null}
    </li>
  );
}

export default async function AdminSalesPage({
  searchParams,
}: {
  searchParams: Promise<{
    period?: string | string[];
    page?: string | string[];
  }>;
}) {
  // The (panel) layout guards too, but a page renders in parallel with its
  // layout — so authorize HERE, before anything is read. React cache() inside
  // requireAdmin() makes the second check free within this render. Kept
  // outside any try/catch: a redirect is thrown and must propagate.
  await requireAdmin();

  const { period: rawPeriod, page: rawPage } = await searchParams;
  const period = parsePeriodKey(rawPeriod);
  const page = parsePageParam(rawPage);
  const range = periodRange(period);

  // Independent reads, started together.
  const [list, total, catalog] = await Promise.all([
    loadSales(range, page),
    loadTotal(range),
    loadCatalog(),
  ]);

  const label = rangeLabel(period, range);
  // Only what the form needs crosses to the client, and only pieces that can
  // still be sold.
  const availablePieces: SalePiece[] = (catalog?.products ?? [])
    .filter((product) => product.availability === "available")
    .map(({ handle, title, price }) => ({ handle, title, price }));

  return (
    <section>
      <p className={LABEL_CLASS}>Panel</p>
      <h1 className="mt-3 font-display text-3xl leading-tight text-ink sm:text-4xl">
        Ventas
      </h1>
      <p className="mt-4 max-w-prose text-base leading-relaxed text-graphite">
        Lo que vendes, lo que costó hacerlo y tu utilidad bruta. Las ventas de
        la tienda en línea se registran solas al pagarse; aquí puedes agregar
        las que hagas por fuera.
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
        <p className={LABEL_CLASS}>Ventas · {label}</p>
        {total === null ? (
          <p className="mt-3 text-sm text-graphite">
            No pudimos calcular los totales.
          </p>
        ) : (
          <>
            <p className={cn(NUMBER_CLASS, "mt-2 text-3xl text-ink sm:text-4xl")}>
              {formatMXN(total.subtotal)}
            </p>
            <p className="mt-1 font-mono text-xs text-graphite">
              {total.count} {total.count === 1 ? "venta" : "ventas"}
              {total.voidedCount > 0
                ? ` · ${total.voidedCount} ${total.voidedCount === 1 ? "anulada" : "anuladas"} (no cuentan)`
                : ""}
            </p>

            <dl className="mt-6 grid gap-5 sm:grid-cols-3">
              <Figure
                label="Costo de lo vendido"
                value={formatMXN(total.costOfGoods)}
              />
              <Figure
                label="Utilidad bruta"
                value={formatMXN(total.grossProfit)}
              />
              <Figure
                label="Envíos cobrados"
                value={formatMXN(total.shipping)}
              />
            </dl>
            <p className="mt-4 max-w-prose text-sm leading-relaxed text-graphite">
              Las ventas son el precio de las piezas, sin el envío: el envío se
              muestra aparte y no entra en la utilidad.
            </p>

            {total.pendingCount > 0 ? (
              <p role="status" className={cn(NOTICE_INFO_CLASS, "mt-4")}>
                {total.pendingCount}{" "}
                {total.pendingCount === 1
                  ? "venta incluye una pieza sin costo registrado"
                  : "ventas incluyen piezas sin costo registrado"}
                : la utilidad bruta es mayor que la real. Registra el costo en{" "}
                <Link href="/admin/piezas" className={LINK_CLASS}>
                  Piezas
                </Link>
                .
              </p>
            ) : null}
            {total.truncated ? (
              <p role="status" className={cn(NOTICE_INFO_CLASS, "mt-4")}>
                Este periodo tiene más de {SALES_SUM_LIMIT} ventas: los totales
                son parciales.
              </p>
            ) : null}
          </>
        )}
      </div>

      <div className="mt-10">
        {list === null ? (
          <LoadError>
            No pudimos cargar las ventas. Recarga la página e inténtalo de
            nuevo.
          </LoadError>
        ) : list.sales.length === 0 ? (
          <div className="border border-line bg-bone-raised px-6 py-10">
            <p className="font-display text-xl text-ink">
              {page > 1 ? "No hay más ventas" : "Sin ventas en este periodo"}
            </p>
            <p className="mt-2 text-graphite">
              {page > 1
                ? "Esta página ya no tiene ventas."
                : "Cuando se pague una pieza en la tienda, o registres una venta aquí, aparecerá en esta lista."}
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
              {list.sales.map((sale) => (
                <SaleRow key={sale.id} sale={sale} />
              ))}
            </ul>
            <Pager
              page={page}
              hasNextPage={list.hasNextPage}
              hrefFor={(target) => listHref(period, target)}
              label="Paginación de ventas"
            />
          </>
        )}
      </div>

      <section aria-labelledby="registrar-venta" className="mt-14">
        <h2
          id="registrar-venta"
          className="font-display text-2xl leading-tight text-ink"
        >
          Registrar venta
        </h2>
        <div className="mt-6">
          {catalog === null ? (
            <LoadError>
              No pudimos cargar tus piezas. Recarga la página e inténtalo de
              nuevo.
            </LoadError>
          ) : availablePieces.length === 0 ? (
            <p className="max-w-prose text-sm leading-relaxed text-graphite">
              No hay piezas disponibles para vender. Publica una pieza en Studio
              y aparecerá aquí.
            </p>
          ) : (
            <div className="max-w-3xl">
              <ManualSaleForm pieces={availablePieces} today={mexicoTodayIso()} />
            </div>
          )}
        </div>
      </section>
    </section>
  );
}
