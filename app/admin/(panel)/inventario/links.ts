import { DEFAULT_PERIOD, type PeriodKey } from "@/lib/admin/domain/periods";

// The URLs of the Inventario page and its two views. Pure strings, so both the
// server page and the client table build their links with the same code.

export const INVENTORY_PATH = "/admin/inventario";

export const INVENTORY_VIEWS = ["materiales", "compras"] as const;
export type InventoryView = (typeof INVENTORY_VIEWS)[number];

export const DEFAULT_VIEW: InventoryView = "materiales";

/** `?vista=` is user-controlled: anything unknown is the materials view. */
export function parseViewParam(raw: string | string[] | undefined): InventoryView {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return INVENTORY_VIEWS.find((view) => view === value) ?? DEFAULT_VIEW;
}

function withQuery(params: URLSearchParams): string {
  const query = params.toString();
  return query ? `${INVENTORY_PATH}?${query}` : INVENTORY_PATH;
}

export function materialsHref(): string {
  return withQuery(new URLSearchParams({ vista: "materiales" }));
}

/** A material's history opens as a modal over the materials view. */
export function historyHref(materialId: string, page = 1): string {
  const params = new URLSearchParams({ vista: "materiales", material: materialId });
  if (page > 1) {
    params.set("page", String(page));
  }
  return withQuery(params);
}

/** The purchases view; the default period and the first page add no params. */
export function purchasesHref(period: PeriodKey = DEFAULT_PERIOD, page = 1): string {
  const params = new URLSearchParams({ vista: "compras" });
  if (period !== DEFAULT_PERIOD) {
    params.set("period", period);
  }
  if (page > 1) {
    params.set("page", String(page));
  }
  return withQuery(params);
}
