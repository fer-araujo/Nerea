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
