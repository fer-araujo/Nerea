import type { Metadata } from "next";
import Link from "next/link";
import { Pager } from "@/components/admin/Pager";
import {
  LABEL_CLASS,
  LINK_CLASS,
  NOTICE_ERROR_CLASS,
  NUMBER_CLASS,
} from "@/components/admin/styles";
import { cn } from "@/lib/cn";
import { requireAdmin } from "@/lib/admin/auth/session";
import { MATERIAL_KIND_LABELS, MOVEMENT_TYPE_LABELS } from "@/lib/admin/copy";
import {
  listMaterials,
  listMovements,
  type Material,
  type MovementPage,
  type StockMovement,
} from "@/lib/admin/data/materials";
import { isDocumentId } from "@/lib/admin/data/shared";
import { formatMXN, inventoryValue } from "@/lib/admin/domain/money";
import { ADMIN_TIME_ZONE } from "@/lib/admin/domain/periods";
import { formatQuantity } from "@/lib/admin/domain/quantity";
import { parsePageParam } from "@/lib/admin/pagination";
import { AdjustStockForm } from "./AdjustStockForm";
import { CreateMaterialForm } from "./CreateMaterialForm";

export const metadata: Metadata = {
  title: "Inventario",
};

const INVENTORY_PATH = "/admin/inventario";

// Shown in the atelier's own time no matter where the server runs.
const DATE_FORMATTER = new Intl.DateTimeFormat("es-MX", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: ADMIN_TIME_ZONE,
});

const TH_CLASS = cn(LABEL_CLASS, "px-3 py-3 font-normal first:pl-0 last:pr-0");
const TD_CLASS = "px-3 py-4 align-top first:pl-0 last:pr-0";

// `?material=` is user-controlled: only a well-formed document id is used.
function parseMaterialParam(raw: string | string[] | undefined): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return isDocumentId(value) ? value : null;
}

function historyHref(materialId: string, page: number): string {
  const query = page <= 1 ? "" : `&page=${page}`;
  return `${INVENTORY_PATH}?material=${materialId}${query}#historial`;
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

function LoadError({ children }: { children: string }) {
  return (
    <p role="alert" className={NOTICE_ERROR_CLASS}>
      {children}
    </p>
  );
}

// Every figure is read from Firestore and rendered ONLY as React text
// children (auto-escaped) — material names are admin-typed but never trusted
// as HTML.
function MaterialsTable({ materials }: { materials: Material[] }) {
  const totalValue = materials.reduce(
    (sum, material) => sum + inventoryValue(material.stock, material.avgCost),
    0,
  );

  return (
    // A scroll region (not a layout squeeze) keeps the columns legible at
    // 360px; tabIndex lets keyboard users scroll it.
    <div
      role="region"
      aria-label="Tabla de materiales"
      tabIndex={0}
      className="overflow-x-auto border-y border-line"
    >
      <table className="w-full min-w-[34rem] border-collapse text-left">
        <caption className="sr-only">
          Materiales con sus existencias, costo promedio por unidad y valor
        </caption>
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className={TH_CLASS}>
              Material
            </th>
            <th scope="col" className={cn(TH_CLASS, "text-right")}>
              Existencias
            </th>
            <th scope="col" className={cn(TH_CLASS, "text-right")}>
              Costo prom. / unidad
            </th>
            <th scope="col" className={cn(TH_CLASS, "text-right")}>
              Valor
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {materials.map((material) => (
            <tr key={material.id}>
              <th scope="row" className={cn(TD_CLASS, "font-normal")}>
                <span className="block font-display text-lg leading-snug text-ink [overflow-wrap:anywhere]">
                  {material.name || "Sin nombre"}
                </span>
                <span className={cn(LABEL_CLASS, "mt-1 block")}>
                  {MATERIAL_KIND_LABELS[material.kind]}
                </span>
                <Link
                  href={historyHref(material.id, 1)}
                  aria-label={`Ver historial de ${material.name || "este material"}`}
                  className={cn(LINK_CLASS, "mt-1")}
                >
                  Historial
                </Link>
              </th>
              <td className={cn(TD_CLASS, NUMBER_CLASS, "text-right text-ink")}>
                {formatQuantity(material.stock, material.unit)}
              </td>
              <td className={cn(TD_CLASS, NUMBER_CLASS, "text-right text-graphite")}>
                {formatMXN(material.avgCost)} / {material.unit}
              </td>
              <td className={cn(TD_CLASS, NUMBER_CLASS, "text-right text-ink")}>
                {formatMXN(inventoryValue(material.stock, material.avgCost))}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-ink/30">
            <th scope="row" colSpan={3} className={cn(TD_CLASS, LABEL_CLASS, "font-normal")}>
              Valor del inventario
            </th>
            <td className={cn(TD_CLASS, NUMBER_CLASS, "text-right text-ink")}>
              {formatMXN(totalValue)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function MovementItem({
  movement,
  unit,
}: {
  movement: StockMovement;
  unit: Material["unit"];
}) {
  const sign = movement.qty > 0 ? "+" : "−";

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
            {DATE_FORMATTER.format(movement.createdAt)}
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

function History({
  material,
  history,
  page,
}: {
  material: Material;
  history: MovementPage | null;
  page: number;
}) {
  return (
    <section id="historial" aria-labelledby="historial-titulo" className="mt-14">
      <p className={LABEL_CLASS}>Historial</p>
      <h2
        id="historial-titulo"
        className="mt-3 font-display text-2xl leading-tight text-ink [overflow-wrap:anywhere]"
      >
        {material.name || "Sin nombre"}
      </h2>
      <p className="mt-2 max-w-prose text-sm leading-relaxed text-graphite">
        Cada compra, vaciado y ajuste, del más reciente al más antiguo. El
        historial no se edita: un error se corrige con un ajuste.
      </p>

      <div className="mt-6">
        {history === null ? (
          <LoadError>
            No pudimos cargar el historial. Recarga la página e inténtalo de
            nuevo.
          </LoadError>
        ) : history.movements.length === 0 ? (
          <div className="border border-line bg-bone-raised px-6 py-8">
            <p className="font-display text-xl text-ink">
              {page > 1 ? "No hay más movimientos" : "Sin movimientos todavía"}
            </p>
            <p className="mt-2 text-graphite">
              {page > 1
                ? "Esta página ya no tiene movimientos."
                : "Aparecerán aquí al registrar una compra, un vaciado o un ajuste."}
            </p>
          </div>
        ) : (
          <>
            <ul className="divide-y divide-line border-y border-line">
              {history.movements.map((movement) => (
                <MovementItem
                  key={movement.id}
                  movement={movement}
                  unit={material.unit}
                />
              ))}
            </ul>
            <Pager
              page={page}
              hasNextPage={history.hasNextPage}
              hrefFor={(target) => historyHref(material.id, target)}
              label="Paginación del historial"
            />
          </>
        )}
      </div>
    </section>
  );
}

export default async function AdminInventoryPage({
  searchParams,
}: {
  searchParams: Promise<{
    material?: string | string[];
    page?: string | string[];
  }>;
}) {
  // The (panel) layout guards too, but a page renders in parallel with its
  // layout — so authorize HERE, before Firestore is touched. React cache()
  // inside requireAdmin() makes the second check free within this render.
  // Kept outside any try/catch: a redirect is thrown and must propagate.
  await requireAdmin();

  const { material: rawMaterial, page: rawPage } = await searchParams;
  const selectedId = parseMaterialParam(rawMaterial);
  const page = parsePageParam(rawPage);

  // Independent reads, started together.
  const [materials, history] = await Promise.all([
    loadMaterials(),
    selectedId ? loadMovements(selectedId, page) : Promise.resolve(null),
  ]);

  const selected =
    materials && selectedId
      ? materials.find((material) => material.id === selectedId)
      : undefined;

  return (
    <section>
      <p className={LABEL_CLASS}>Panel</p>
      <h1 className="mt-3 font-display text-3xl leading-tight text-ink sm:text-4xl">
        Inventario
      </h1>
      <p className="mt-4 max-w-prose text-base leading-relaxed text-graphite">
        Existencias de metales, ligas y piedras, con su costo promedio. Solo
        cambian con compras, vaciados y ajustes.
      </p>

      <div className="mt-10">
        {materials === null ? (
          <LoadError>
            No pudimos cargar el inventario. Recarga la página e inténtalo de
            nuevo.
          </LoadError>
        ) : materials.length === 0 ? (
          <div className="border border-line bg-bone-raised px-6 py-10">
            <p className="font-display text-xl text-ink">Aún no hay materiales</p>
            <p className="mt-2 max-w-prose text-graphite">
              Crea tu primer material aquí abajo. Para cargar lo que ya tienes,
              regístralo como una compra llamada «Inventario inicial» en
              Inversiones, con su costo.
            </p>
            <Link href="/admin/inversiones" className={cn(LINK_CLASS, "mt-3")}>
              Ir a Inversiones
            </Link>
          </div>
        ) : (
          <MaterialsTable materials={materials} />
        )}
      </div>

      {materials !== null ? (
        <div className="mt-14 grid gap-12 lg:grid-cols-2">
          <section aria-labelledby="nuevo-material">
            <h2
              id="nuevo-material"
              className="font-display text-2xl leading-tight text-ink"
            >
              Nuevo material
            </h2>
            <div className="mt-6">
              <CreateMaterialForm />
            </div>
          </section>

          <section aria-labelledby="ajustar-existencias">
            <h2
              id="ajustar-existencias"
              className="font-display text-2xl leading-tight text-ink"
            >
              Ajustar existencias
            </h2>
            <div className="mt-6">
              <AdjustStockForm
                materials={materials.map(({ id, name, unit }) => ({
                  id,
                  name,
                  unit,
                }))}
              />
            </div>
          </section>
        </div>
      ) : null}

      {selected ? (
        <History material={selected} history={history} page={page} />
      ) : materials !== null && selectedId ? (
        <div className="mt-10">
          <LoadError>No encontramos ese material.</LoadError>
        </div>
      ) : null}
    </section>
  );
}
