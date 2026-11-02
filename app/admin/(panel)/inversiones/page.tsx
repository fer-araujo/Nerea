import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin/auth/session";
import { parsePeriodKey } from "@/lib/admin/domain/periods";
import { parsePageParam } from "@/lib/admin/pagination";
import { purchasesHref } from "../inventario/links";

export const metadata: Metadata = {
  title: "Inventario",
};

// "Inversiones" and "Inventario" were the same thing seen from two sides, so
// the purchases now live in the Compras tab of Inventario. This route stays
// only so old bookmarks and links keep working: a permanent redirect, which
// carries over the period and page that were asked for.
export default async function AdminInvestmentsRedirect({
  searchParams,
}: {
  searchParams: Promise<{
    period?: string | string[];
    page?: string | string[];
  }>;
}) {
  // Authorize first, like every panel page: a signed-out visitor is sent to
  // the login, not told where the purchases went. Outside any try/catch, a
  // redirect is thrown and must propagate.
  await requireAdmin();

  const { period: rawPeriod, page: rawPage } = await searchParams;
  permanentRedirect(
    purchasesHref(parsePeriodKey(rawPeriod), parsePageParam(rawPage)),
  );
}
