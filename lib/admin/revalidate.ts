import "server-only";
import { revalidatePath } from "next/cache";

// Materials feed all three modules (stock figures, the pickers, the history),
// so any change to the ledger refreshes every page that reads it.
const LEDGER_PATHS = [
  "/admin/calculadora",
  "/admin/inventario",
  "/admin/inversiones",
] as const;

export function revalidateLedgerViews(): void {
  for (const path of LEDGER_PATHS) {
    revalidatePath(path);
  }
}

// A piece's cost is read by the pieces page alone: sales keep the cost they
// froze when they were recorded, so they don't change when a cost does.
const PIECES_PATH = "/admin/piezas";

export function revalidatePieceViews(): void {
  revalidatePath(PIECES_PATH);
}

// Recording or voiding a sale changes the sales list and totals, and the
// pieces page too (a sold piece shows as sold there).
const SALES_PATHS = ["/admin/ventas", PIECES_PATH] as const;

export function revalidateSalesViews(): void {
  for (const path of SALES_PATHS) {
    revalidatePath(path);
  }
}
