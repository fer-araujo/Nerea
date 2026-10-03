import type { Metadata } from "next";
import Link from "next/link";
import {
  BADGE_ATTENTION_CLASS,
  LABEL_CLASS,
  LINK_CLASS,
  NOTICE_ERROR_CLASS,
  NOTICE_INFO_CLASS,
  NUMBER_CLASS,
} from "@/components/admin/styles";
import { cn } from "@/lib/cn";
import { requireAdmin } from "@/lib/admin/auth/session";
import {
  CATALOG_LIMIT,
  listCatalog,
  type Catalog,
  type CatalogProduct,
} from "@/lib/admin/data/catalog";
import { listMaterials, type Material } from "@/lib/admin/data/materials";
import { listPieces, type PieceRecord } from "@/lib/admin/data/pieces";
import { isPieceHandle } from "@/lib/admin/data/shared";
import { centavosToPesosText, formatMXN } from "@/lib/admin/domain/money";
import {
  formatPercent,
  pieceCostTotal,
  pieceMargin,
} from "@/lib/admin/domain/pieces";
import {
  PieceCostForm,
  type PieceCostMaterial,
  type PieceCostValues,
} from "./PieceCostForm";

export const metadata: Metadata = {
  title: "Piezas",
};

const PIECES_PATH = "/admin/piezas";

const TH_CLASS = cn(LABEL_CLASS, "px-3 py-3 font-normal first:pl-0 last:pr-0");
const TD_CLASS = "px-3 py-4 align-top first:pl-0 last:pr-0";

// `?pieza=` is user-controlled: only a handle that can be a document id is used.
function parsePieceParam(raw: string | string[] | undefined): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return isPieceHandle(value) ? value : null;
}

function editHref(handle: string): string {
  return `${PIECES_PATH}?pieza=${encodeURIComponent(handle)}#editar-costo`;
}

// `null` = Firebase (or Sanity) not configured; a throw = a read failure.
// Either way the page shows a notice instead of crashing the panel.
async function loadCatalog(): Promise<Catalog | null> {
  try {
    return await listCatalog();
  } catch {
    return null;
  }
}

async function loadPieces(): Promise<PieceRecord[] | null> {
  try {
    return await listPieces();
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

// Only what the helper needs crosses to the client: metals and alloys are
// weighed in grams, and the helper prices them per gram.
function toCostMaterials(materials: Material[]): PieceCostMaterial[] {
  return materials
    .filter(
      (material) =>
        material.unit === "g" &&
        (material.kind === "fine_silver" ||
          material.kind === "fine_gold" ||
          material.kind === "alloy"),
    )
    .map(({ id, name, avgCost }) => ({ id, name, avgCost }));
}

function initialValues(record: PieceRecord | undefined): PieceCostValues {
  if (!record) {
    return {
      metal: "",
      stones: "",
      other: "",
      labor: "",
      metalGrams: "",
      materialId: "",
      note: "",
    };
  }
  return {
    metal: centavosToPesosText(record.costs.metal),
    stones: centavosToPesosText(record.costs.stones),
    other: centavosToPesosText(record.costs.other),
    labor:
      record.costs.labor === undefined
        ? ""
        : centavosToPesosText(record.costs.labor),
    metalGrams: record.metalGrams === null ? "" : String(record.metalGrams),
    materialId: record.materialId ?? "",
    note: record.note ?? "",
  };
}

// Titles, categories and notes are admin-typed in Studio / here: rendered ONLY
// as React text children (auto-escaped), never as HTML.
function PiecesTable({
  products,
  records,
}: {
  products: CatalogProduct[];
  records: Map<string, PieceRecord>;
}) {
  return (
    // A scroll region (not a layout squeeze) keeps the columns legible at
    // 360px; tabIndex lets keyboard users scroll it.
    <div
      role="region"
      aria-label="Tabla de piezas"
      tabIndex={0}
      className="overflow-x-auto border-y border-line"
    >
      <table className="w-full min-w-[40rem] border-collapse text-left">
        <caption className="sr-only">
          Piezas con su precio, costo, utilidad y margen
        </caption>
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className={TH_CLASS}>
              Pieza
            </th>
            <th scope="col" className={cn(TH_CLASS, "text-right")}>
              Precio
            </th>
            <th scope="col" className={cn(TH_CLASS, "text-right")}>
              Costo
            </th>
            <th scope="col" className={cn(TH_CLASS, "text-right")}>
              Utilidad
            </th>
            <th scope="col" className={cn(TH_CLASS, "text-right")}>
              Margen
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {products.map((product) => {
            const record = records.get(product.handle);
            const cost = record ? pieceCostTotal(record.costs) : null;
            const figures =
              cost === null ? null : pieceMargin(product.price, cost);
            const name = product.title || "Sin nombre";

            return (
              <tr key={product.handle}>
                <th scope="row" className={cn(TD_CLASS, "font-normal")}>
                  <span className="block font-display text-lg leading-snug text-ink [overflow-wrap:anywhere]">
                    {name}
                  </span>
                  <span className={cn(LABEL_CLASS, "mt-1 block")}>
                    {product.categoryTitle ?? "Sin categoría"} ·{" "}
                    {product.availability === "sold" ? "Vendida" : "Disponible"}
                  </span>
                  {isPieceHandle(product.handle) ? (
                    <Link
                      href={editHref(product.handle)}
                      aria-label={`Editar costo de ${name}`}
                      className={cn(LINK_CLASS, "mt-1")}
                    >
                      {record ? "Editar costo" : "Registrar costo"}
                    </Link>
                  ) : null}
                </th>
                <td className={cn(TD_CLASS, NUMBER_CLASS, "text-right text-ink")}>
                  {formatMXN(product.price)}
                </td>
                <td className={cn(TD_CLASS, NUMBER_CLASS, "text-right text-ink")}>
                  {cost === null ? (
                    <span className={BADGE_ATTENTION_CLASS}>Costo pendiente</span>
                  ) : (
                    formatMXN(cost)
                  )}
                </td>
                <td className={cn(TD_CLASS, NUMBER_CLASS, "text-right text-ink")}>
                  {figures === null ? "—" : formatMXN(figures.margin)}
                </td>
                <td
                  className={cn(TD_CLASS, NUMBER_CLASS, "text-right text-graphite")}
                >
                  {figures === null || figures.marginPercent === null
                    ? "—"
                    : formatPercent(figures.marginPercent)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default async function AdminPiecesPage({
  searchParams,
}: {
  searchParams: Promise<{ pieza?: string | string[] }>;
}) {
  // The (panel) layout guards too, but a page renders in parallel with its
  // layout — so authorize HERE, before anything is read. React cache() inside
  // requireAdmin() makes the second check free within this render. Kept
  // outside any try/catch: a redirect is thrown and must propagate.
  await requireAdmin();

  const { pieza: rawPiece } = await searchParams;
  const selectedHandle = parsePieceParam(rawPiece);

  // Independent reads, started together. Materials only feed the metal helper
  // of the edit form, so they are read only when a piece is being edited.
  const [catalog, pieces, materials] = await Promise.all([
    loadCatalog(),
    loadPieces(),
    selectedHandle ? loadMaterials() : Promise.resolve(null),
  ]);

  const records = new Map(
    (pieces ?? []).map((record) => [record.handle, record] as const),
  );
  const pendingCount =
    catalog === null
      ? 0
      : catalog.products.filter((product) => !records.has(product.handle))
          .length;
  const selected =
    catalog && selectedHandle
      ? catalog.products.find((product) => product.handle === selectedHandle)
      : undefined;

  return (
    <section>
      <p className={LABEL_CLASS}>Panel</p>
      <h1 className="mt-3 font-display text-3xl leading-tight text-ink sm:text-4xl">
        Piezas
      </h1>
      <p className="mt-4 max-w-prose text-base leading-relaxed text-graphite">
        Lo que cuesta hacer cada pieza y su utilidad frente al precio de la
        tienda. Una pieza sin costo registrado queda como «Costo pendiente», y
        las ventas que la incluyan también.
      </p>

      <div className="mt-10">
        {catalog === null ? (
          <LoadError>
            No pudimos cargar el catálogo. Recarga la página e inténtalo de
            nuevo.
          </LoadError>
        ) : pieces === null ? (
          <LoadError>
            No pudimos cargar los costos de las piezas. Recarga la página e
            inténtalo de nuevo.
          </LoadError>
        ) : catalog.products.length === 0 ? (
          <div className="border border-line bg-bone-raised px-6 py-10">
            <p className="font-display text-xl text-ink">
              Aún no hay piezas en el catálogo
            </p>
            <p className="mt-2 max-w-prose text-graphite">
              Cuando publiques una pieza en Studio, aparecerá aquí para
              registrar su costo.
            </p>
          </div>
        ) : (
          <>
            <p className="mb-4 font-mono text-xs text-graphite">
              {catalog.products.length}{" "}
              {catalog.products.length === 1 ? "pieza" : "piezas"} ·{" "}
              {pendingCount} con costo pendiente
            </p>
            <PiecesTable products={catalog.products} records={records} />
            {catalog.truncated ? (
              <p role="status" className={cn(NOTICE_INFO_CLASS, "mt-4")}>
                El catálogo tiene más de {CATALOG_LIMIT} piezas: solo se
                muestran las más recientes.
              </p>
            ) : null}
          </>
        )}
      </div>

      {selected ? (
        <section
          id="editar-costo"
          aria-labelledby="editar-costo-titulo"
          className="mt-14"
        >
          <h2
            id="editar-costo-titulo"
            className="font-display text-2xl leading-tight text-ink"
          >
            Costo de la pieza
          </h2>
          <div className="mt-6 max-w-2xl">
            {/* `key` gives each piece its own form state: switching pieces
                must never carry over what was typed for the last one. */}
            <PieceCostForm
              key={selected.handle}
              handle={selected.handle}
              title={selected.title}
              price={selected.price}
              initial={initialValues(records.get(selected.handle))}
              materials={toCostMaterials(materials ?? [])}
              materialsUnavailable={materials === null}
            />
          </div>
        </section>
      ) : catalog !== null && selectedHandle ? (
        <div className="mt-10">
          <LoadError>No encontramos esa pieza en el catálogo.</LoadError>
        </div>
      ) : null}
    </section>
  );
}
