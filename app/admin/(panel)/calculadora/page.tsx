import type { Metadata } from "next";
import { LABEL_CLASS } from "@/components/admin/styles";
import { requireAdmin } from "@/lib/admin/auth/session";
import { listMaterials, type Material } from "@/lib/admin/data/materials";
import { mexicoTodayIso } from "@/lib/admin/domain/periods";
import { CastingCalculator } from "./CastingCalculator";

export const metadata: Metadata = {
  title: "Calculadora",
};

// `null` = Firebase not configured; a throw = Firestore failure. The
// calculator itself needs no data, so it still works; only registering a
// casting needs the materials, and the form says so.
async function loadMaterials(): Promise<Material[] | null> {
  try {
    return await listMaterials();
  } catch {
    return null;
  }
}

export default async function AdminCalculatorPage() {
  // The (panel) layout guards too, but a page renders in parallel with its
  // layout — so authorize HERE, before Firestore is touched. React cache()
  // inside requireAdmin() makes the second check free within this render.
  // Kept outside the try/catch above: a redirect is thrown and must propagate.
  await requireAdmin();

  const materials = await loadMaterials();

  // Only what the picker needs crosses to the client: castings draw fine
  // metal and alloy, weighed in grams. (Not the whole ledger record.)
  const options = (materials ?? [])
    .filter(
      (material) =>
        material.unit === "g" &&
        (material.kind === "fine_silver" ||
          material.kind === "fine_gold" ||
          material.kind === "alloy"),
    )
    .map(({ id, name, kind, stock }) => ({ id, name, kind, stock }));

  return (
    <section>
      <p className={LABEL_CLASS}>Panel</p>
      <h1 className="mt-3 font-display text-3xl leading-tight text-ink sm:text-4xl">
        Calculadora de vaciado
      </h1>
      <p className="mt-4 max-w-prose text-base leading-relaxed text-graphite">
        Cuánto metal fundir, cuánto fino y cuánta liga pesar, a partir del peso
        de la cera. Cuando vacíes, regístralo para descontar tus existencias.
      </p>

      <div className="mt-10">
        <CastingCalculator
          materials={options}
          today={mexicoTodayIso()}
          materialsUnavailable={materials === null}
        />
      </div>
    </section>
  );
}
