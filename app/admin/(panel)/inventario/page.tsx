import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Modal } from "@/components/admin/Modal";
import { Pager } from "@/components/admin/Pager";
import { PeriodNav } from "@/components/admin/PeriodNav";
import {
  BADGE_CLASS,
  LABEL_CLASS,
  LINK_CLASS,
  NOTICE_ERROR_CLASS,
  NOTICE_INFO_CLASS,
  NUMBER_CLASS,
  PANEL_CLASS,
} from "@/components/admin/styles";
import { ViewTabs } from "@/components/admin/ViewTabs";
import { cn } from "@/lib/cn";
import { requireAdmin } from "@/lib/admin/auth/session";
import { MOVEMENT_TYPE_LABELS, periodRangeLabel } from "@/lib/admin/copy";
import {
  listMaterials,
  listMovements,
  type Material,
  type MovementPage,
  type StockMovement,
} from "@/lib/admin/data/materials";
import {
  PURCHASE_SUM_LIMIT,
  listPurchases,
  sumPurchases,
  type Purchase,
  type PurchasePage,
  type PurchaseTotal,
} from "@/lib/admin/data/purchases";
import { isDocumentId } from "@/lib/admin/data/shared";
import { formatMXN } from "@/lib/admin/domain/money";
import {
  ADMIN_TIME_ZONE,
  mexicoTodayIso,
  parsePeriodKey,
  periodRange,
  type PeriodKey,
  type PeriodRange,
} from "@/lib/admin/domain/periods";
import { formatQuantity } from "@/lib/admin/domain/quantity";
import { parsePageParam } from "@/lib/admin/pagination";
import { CreateMaterialForm } from "./CreateMaterialForm";
import { HistoryModal } from "./HistoryModal";
import { MaterialsTable } from "./MaterialsTable";
import { PurchaseForm } from "./PurchaseForm";
import {
  historyHref,
  materialsHref,
  parseViewParam,
  purchasesHref,
  type InventoryView,
} from "./links";

export const metadata: Metadata = {
  title: "Inventario",
};

// Shown in the atelier's own time no matter where the server runs.
const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("es-MX", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: ADMIN_TIME_ZONE,
});
const DATE_FORMATTER = new Intl.DateTimeFormat("es-MX", {
  dateStyle: "medium",
  timeZone: ADMIN_TIME_ZONE,
});

const VIEW_TABS = [
  { key: "materiales", label: "Materiales", href: materialsHref() },
  { key: "compras", label: "Compras", href: purchasesHref() },
] as const;

// `?material=` is user-controlled: only a well-formed document id is used.
function parseMaterialParam(raw: string | string[] | undefined): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return isDocumentId(value) ? value : null;
}

// `null` = Firebase not configured; a throw = Firestore failure. Either way
// the page shows a notice instead of crashing the panel.
async function loadMaterials(): Promise<Material[] | null> {
  try {
    return await listMaterials();
  } catch {
    return null;
  }
}

async function loadMovements(
  materialId: string,
  page: number,
): Promise<MovementPage | null> {
  try {
    return await listMovements(materialId, page);
  } catch {
    return null;
  }
}

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

function LoadError({ children }: { children: string }) {
  return (
    <p role="alert" className={NOTICE_ERROR_CLASS}>
      {children}
    </p>
  );
}

// ---- materiales ---------------------------------------------------------

function MovementItem({
  movement,
  unit,
}: {
  movement: StockMovement;
  unit: Material["unit"];
}) {
  const sign = movement.qty > 0 ? "+" : movement.qty < 0 ? "−" : "";

  return (
    <li className="py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="font-sans text-sm text-ink">
          {MOVEMENT_TYPE_LABELS[movement.type]}
        </span>
        {/* The sign carries the direction; color stays out of it (jade is
            reserved for the storefront's "available" signal). */}
        <span className={cn(NUMBER_CLASS, "text-sm text-ink")}>
          {sign}
          {formatQuantity(Math.abs(movement.qty), unit)}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-graphite">
        {movement.createdAt ? (
          <time dateTime={movement.createdAt.toISOString()}>
            {DATE_TIME_FORMATTER.format(movement.createdAt)}
          </time>
        ) : null}
        {movement.totalCost !== null ? (
          <span>
            {formatMXN(movement.totalCost)}
            {movement.unitCost !== null
              ? ` · ${formatMXN(movement.unitCost)} / ${unit}`
              : ""}
          </span>
        ) : null}
      </div>
      {movement.note ? (
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-graphite [overflow-wrap:anywhere]">
          {movement.note}
        </p>
      ) : null}
    </li>
  );
}

// The body of the history modal.
function HistoryList({
  material,
  history,
  page,
}: {
  material: Material;
  history: MovementPage | null;
  page: number;
}) {
  if (history === null) {
    return (
      <LoadError>
        No pudimos cargar el historial. Recarga la página e inténtalo de nuevo.
      </LoadError>
    );
  }

  if (history.movements.length === 0) {
    return (
      <div className="border border-line bg-bone-raised px-6 py-8">
        <p className="font-display text-xl text-ink">
          {page > 1 ? "No hay más movimientos" : "Sin movimientos todavía"}
        </p>
        <p className="mt-2 text-graphite">
          {page > 1
            ? "Esta página ya no tiene movimientos."
            : "Aparecerán aquí al registrar una compra, un vaciado, un ajuste o una corrección."}
        </p>
      </div>
    );
  }

  return (
    <>
      <ul className="divide-y divide-line border-y border-line">
        {history.movements.map((movement) => (
          <MovementItem key={movement.id} movement={movement} unit={material.unit} />
        ))}
      </ul>
      <Pager
        page={page}
        hasNextPage={history.hasNextPage}
        hrefFor={(target) => historyHref(material.id, target)}
        label="Paginación del historial"
      />
    </>
  );
}

function MaterialsView({
  materials,
  selectedId,
  history,
  page,
}: {
  materials: Material[] | null;
  selectedId: string | null;
  history: MovementPage | null;
  page: number;
}) {
  const selected =
    materials && selectedId
      ? materials.find((material) => material.id === selectedId)
      : undefined;

  return (
    <>
      {materials !== null ? (
        <div className="mt-8">
          <Modal
            title="Nuevo material"
            triggerLabel="Nuevo material"
            triggerVariant="primary"
          >
            <CreateMaterialForm />
          </Modal>
        </div>
      ) : null}

      <div className="mt-8">
        {materials === null ? (
          <LoadError>
            No pudimos cargar el inventario. Recarga la página e inténtalo de
            nuevo.
          </LoadError>
        ) : materials.length === 0 ? (
          <div className="border border-line bg-bone-raised px-6 py-10">
            <p className="font-display text-xl text-ink">Aún no hay materiales</p>
            <p className="mt-2 max-w-prose text-graphite">
              Crea tu primer material con «Nuevo material». Si ya tienes
              existencias, escribe cuánto tienes y cuánto te costó en total:
              así el inventario y el costo promedio parten de un valor real.
            </p>
          </div>
        ) : (
          <MaterialsTable
            materials={materials.map(
              ({ id, name, kind, unit, stock, avgCost }) => ({
                id,
                name,
                kind,
                unit,
                stock,
                avgCost,
              }),
            )}
            today={mexicoTodayIso()}
          />
        )}
      </div>

      {selected ? (
        <HistoryModal
          title={`Historial · ${selected.name || "Sin nombre"}`}
          description="Cada compra, vaciado, ajuste y corrección, del más reciente al más antiguo. El historial no se edita: un error se corrige con una corrección."
          closeHref={materialsHref()}
          returnFocusId={`historial-${selected.id}`}
        >
          <HistoryList material={selected} history={history} page={page} />
        </HistoryModal>
      ) : materials !== null && selectedId ? (
        <div className="mt-10">
          <LoadError>No encontramos ese material.</LoadError>
        </div>
      ) : null}
    </>
  );
}

// ---- compras ------------------------------------------------------------

// Supplier, note and material names are admin-typed: rendered ONLY as React
// text children (auto-escaped), never as HTML.
function PurchaseItem({
  purchase,
  units,
}: {
  purchase: Purchase;
  units: Map<string, Material["unit"]>;
}) {
  // An opening-stock purchase is named after what it opened, not after a
  // supplier it never had.
  const title = purchase.initial
    ? purchase.items
        .map((item) => item.materialName)
        .filter(Boolean)
        .join(", ") || "Inventario inicial"
    : (purchase.supplier ?? "Compra");

  return (
    <li className="py-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="font-display text-lg leading-snug text-ink [overflow-wrap:anywhere]">
          {title}
        </h3>
        <span className={cn(NUMBER_CLASS, "text-base text-ink")}>
          {formatMXN(purchase.totalCost)}
        </span>
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
        {purchase.date ? (
          <time
            dateTime={purchase.date.toISOString()}
            className="font-mono text-xs text-graphite"
          >
            {DATE_FORMATTER.format(purchase.date)}
          </time>
        ) : null}
        {purchase.initial ? (
          <span className={BADGE_CLASS}>Inventario inicial</span>
        ) : null}
      </div>

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

function PurchasesView({
  period,
  range,
  page,
  list,
  total,
  materials,
}: {
  period: PeriodKey;
  range: PeriodRange;
  page: number;
  list: PurchasePage | null;
  total: PurchaseTotal | null;
  materials: Material[] | null;
}) {
  const units = new Map(
    (materials ?? []).map((material) => [material.id, material.unit] as const),
  );

  return (
    <>
      <PeriodNav
        current={period}
        hrefFor={(key) => purchasesHref(key, 1)}
        className="mt-8"
      />

      <div className={cn(PANEL_CLASS, "mt-8")}>
        <p className={LABEL_CLASS}>
          Total invertido · {periodRangeLabel(period, range)}
        </p>
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
            {total.initialCount > 0 ? (
              <p className="mt-2 max-w-prose text-sm leading-relaxed text-graphite">
                El inventario inicial no cuenta como inversión del periodo: ya
                lo tenías.
              </p>
            ) : null}
            {total.truncated ? (
              <p role="status" className={cn(NOTICE_INFO_CLASS, "mt-4")}>
                Este periodo tiene más de {PURCHASE_SUM_LIMIT} compras: el total
                es parcial.
              </p>
            ) : null}
          </>
        )}
      </div>

      <div className="mt-8">
        {materials === null ? (
          <LoadError>
            No pudimos cargar tus materiales. Recarga la página e inténtalo de
            nuevo.
          </LoadError>
        ) : materials.length === 0 ? (
          <p className="max-w-prose text-sm leading-relaxed text-graphite">
            Primero crea tus materiales en la pestaña{" "}
            <Link href={materialsHref()} className={LINK_CLASS}>
              Materiales
            </Link>
            ; después podrás registrar aquí sus compras.
          </p>
        ) : (
          <Modal
            title="Registrar compra"
            description="Cada compra suma a las existencias y recalcula el costo promedio de cada material."
            triggerLabel="Registrar compra"
            triggerVariant="primary"
            size="lg"
          >
            <PurchaseForm
              today={mexicoTodayIso()}
              materials={materials.map(({ id, name, unit }) => ({
                id,
                name,
                unit,
              }))}
            />
          </Modal>
        )}
      </div>

      <div className="mt-8">
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
                href={purchasesHref(period, 1)}
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
              hrefFor={(target) => purchasesHref(period, target)}
              label="Paginación de compras"
            />
          </>
        )}
      </div>
    </>
  );
}

// ---- page ---------------------------------------------------------------

function InventoryShell({
  view,
  children,
}: {
  view: InventoryView;
  children: ReactNode;
}) {
  return (
    <section>
      <p className={LABEL_CLASS}>Panel</p>
      <h1 className="mt-3 font-display text-3xl leading-tight text-ink sm:text-4xl">
        Inventario
      </h1>
      <p className="mt-4 max-w-prose text-base leading-relaxed text-graphite">
        Existencias de metales, ligas y piedras, con su costo promedio, y lo que
        compras para tenerlas. Cambian con compras, vaciados, ajustes y
        correcciones.
      </p>

      <ViewTabs
        label="Vista del inventario"
        tabs={VIEW_TABS}
        current={view}
        className="mt-10"
      />

      {children}
    </section>
  );
}

export default async function AdminInventoryPage({
  searchParams,
}: {
  searchParams: Promise<{
    vista?: string | string[];
    material?: string | string[];
    period?: string | string[];
    page?: string | string[];
  }>;
}) {
  // The (panel) layout guards too, but a page renders in parallel with its
  // layout — so authorize HERE, before Firestore is touched. React cache()
  // inside requireAdmin() makes the second check free within this render.
  // Kept outside any try/catch: a redirect is thrown and must propagate.
  await requireAdmin();

  const {
    vista: rawView,
    material: rawMaterial,
    period: rawPeriod,
    page: rawPage,
  } = await searchParams;
  const view = parseViewParam(rawView);
  const page = parsePageParam(rawPage);

  if (view === "compras") {
    const period = parsePeriodKey(rawPeriod);
    const range = periodRange(period);

    // Independent reads, started together.
    const [list, total, materials] = await Promise.all([
      loadPurchases(range, page),
      loadTotal(range),
      loadMaterials(),
    ]);

    return (
      <InventoryShell view={view}>
        <PurchasesView
          period={period}
          range={range}
          page={page}
          list={list}
          total={total}
          materials={materials}
        />
      </InventoryShell>
    );
  }

  const selectedId = parseMaterialParam(rawMaterial);
  const [materials, history] = await Promise.all([
    loadMaterials(),
    selectedId ? loadMovements(selectedId, page) : Promise.resolve(null),
  ]);

  return (
    <InventoryShell view={view}>
      <MaterialsView
        materials={materials}
        selectedId={selectedId}
        history={history}
        page={page}
      />
    </InventoryShell>
  );
}
