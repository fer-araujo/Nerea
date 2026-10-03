"use client";

import Link from "next/link";
import { useId, useState, type FormEvent } from "react";
import { FormNotice } from "@/components/admin/FormNotice";
import {
  FIELD_CLASS,
  INPUT_CLASS,
  LABEL_CLASS,
  LINK_CLASS,
  NOTICE_ERROR_CLASS,
  NUMBER_CLASS,
  PANEL_CLASS,
  PRIMARY_BUTTON_CLASS,
  SELECT_CLASS,
} from "@/components/admin/styles";
import { useAdminAction } from "@/components/admin/useAdminAction";
import { cn } from "@/lib/cn";
import { castingErrorMessage, MATERIAL_KIND_LABELS } from "@/lib/admin/copy";
import {
  GOLD_COLORS,
  GOLD_COLOR_LABELS,
  METAL_KEYS,
  METAL_PRESETS,
  defaultsFor,
  isGoldMetal,
  metalFromWax,
  safeCalculateCasting,
  type AlloySplit,
  type CastingCalculation,
  type GoldColor,
  type MetalKey,
} from "@/lib/admin/domain/casting";
import { fineKindFor, type MaterialKind } from "@/lib/admin/domain/inventory";
import {
  formatDecimal,
  formatGrams,
  toHundredths,
} from "@/lib/admin/domain/quantity";
import { registerCastingAction } from "./actions";

export interface CalculatorMaterial {
  id: string;
  name: string;
  kind: MaterialKind;
  /** Grams on hand. */
  stock: number;
}

const DEFAULT_ALLOWANCE_PERCENT = "10";

// An empty field is "not typed yet" (NaN, so it is reported as missing), not 0.
function toNumber(text: string): number {
  return text.trim() === "" ? Number.NaN : Number(text);
}

interface Figures {
  wax: number;
  density: number;
  fineness: number;
  /** A fraction: 0.1 = 10 %. */
  allowance: number;
  recycled: number;
}

// The three steps with the jeweler's own numbers filled in. Metal and fine
// are shown UNROUNDED (up to three decimals) because that is what the
// rounded results are taken from: 71.885 g x 0.585 = 42.053 g -> 42.05 g.
// Showing the already-rounded 71.89 g there would make the sum look off by a
// hundredth against a hand calculation.
function describeSteps(figures: Figures, split: AlloySplit) {
  const rawMetal = metalFromWax(
    figures.wax,
    figures.density,
    figures.allowance,
  );
  const rawFine = Math.max(rawMetal - figures.recycled, 0) * figures.fineness;

  return {
    metal: `${formatDecimal(figures.wax)} g × ${formatDecimal(figures.density)} × (1 + ${formatDecimal(figures.allowance)}) = ${formatDecimal(rawMetal)} g`,
    fine: `(${formatDecimal(rawMetal)} − ${formatDecimal(figures.recycled)}) × ${formatDecimal(figures.fineness, 5)} = ${formatDecimal(rawFine)} g`,
    alloy: `${formatDecimal(split.metal, 2)} − ${formatDecimal(split.recycled, 2)} − ${formatDecimal(split.fine, 2)} = ${formatDecimal(split.alloy, 2)} g`,
  };
}

type Steps = ReturnType<typeof describeSteps>;

function Figure({
  label,
  value,
  large = false,
}: {
  label: string;
  value: string;
  large?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line pb-3 last:border-b-0 last:pb-0">
      <dt className={LABEL_CLASS}>{label}</dt>
      <dd className={cn(NUMBER_CLASS, "text-ink", large ? "text-2xl" : "text-xl")}>
        {value}
      </dd>
    </div>
  );
}

function ResultsPanel({
  calculation,
}: {
  calculation: CastingCalculation | null;
}) {
  return (
    <section aria-labelledby="resultado-titulo" className={PANEL_CLASS}>
      <h2 id="resultado-titulo" className={LABEL_CLASS}>
        Resultado
      </h2>
      {/* Polite live region: the figures update as the jeweler types. */}
      <div aria-live="polite" className="mt-4">
        {calculation === null ? (
          <p className="text-sm leading-relaxed text-graphite">
            Escribe el peso de cera para ver cuánto metal necesitas.
          </p>
        ) : calculation.ok ? (
          <dl className="flex flex-col gap-3">
            <Figure label="Metal total" value={formatGrams(calculation.value.metal)} large />
            <Figure label="Fino" value={formatGrams(calculation.value.fine)} />
            <Figure label="Liga" value={formatGrams(calculation.value.alloy)} />
            {calculation.value.recycled > 0 ? (
              <Figure label="Reciclado" value={formatGrams(calculation.value.recycled)} />
            ) : null}
          </dl>
        ) : (
          <p className="text-sm leading-relaxed text-ink">
            {castingErrorMessage(calculation.error)}
          </p>
        )}
      </div>
    </section>
  );
}

function FormulaSteps({ steps }: { steps: Steps | null }) {
  return (
    <section aria-labelledby="formula-titulo" className="mt-8">
      <h2 id="formula-titulo" className={LABEL_CLASS}>
        Cómo se calcula
      </h2>
      <ol className="mt-4 flex list-decimal flex-col gap-4 pl-5 text-sm leading-relaxed text-graphite">
        <li>
          <span className="text-ink">Metal total</span> = peso de cera × densidad ×
          (1 + bebedero). La cera se reemplaza por el mismo volumen de metal y el
          bebedero agrega el botón y los canales.
          {steps ? (
            <span className={cn(NUMBER_CLASS, "mt-1 block text-ink")}>{steps.metal}</span>
          ) : null}
        </li>
        <li>
          <span className="text-ink">Fino</span> = (metal − reciclado) × ley. Es
          el metal puro que hay que pesar.
          {steps ? (
            <span className={cn(NUMBER_CLASS, "mt-1 block text-ink")}>{steps.fine}</span>
          ) : null}
        </li>
        <li>
          <span className="text-ink">Liga</span> = metal − reciclado − fino. Es
          lo que falta, así fino + liga + reciclado siempre suman el metal total.
          {steps ? (
            <span className={cn(NUMBER_CLASS, "mt-1 block text-ink")}>{steps.alloy}</span>
          ) : null}
        </li>
      </ol>
      <p className="mt-4 text-sm leading-relaxed text-graphite">
        Se calcula con todos los decimales y el resultado se redondea a 0.01 g.
        La densidad y la ley vienen de la tabla del metal; puedes cambiarlas si
        tu aleación es otra.
      </p>
    </section>
  );
}

// The calculator runs ENTIRELY in the browser while the jeweler types — the
// same pure functions the server uses (lib/admin/domain/casting.ts), nothing
// sent anywhere. "Registrar vaciado" is a separate form: it posts the RAW
// inputs and the chosen materials, and the server recomputes everything
// itself (the figures shown here are never sent, nor believed). Keeping it
// apart from the inputs also means pressing Enter while typing a weight can
// never register a casting by accident.
export function CastingCalculator({
  materials,
  today,
  materialsUnavailable,
}: {
  materials: CalculatorMaterial[];
  /** `YYYY-MM-DD` in Mexico City, computed on the server. */
  today: string;
  materialsUnavailable: boolean;
}) {
  const { result, pending, submit } = useAdminAction(registerCastingAction);
  const blockedId = useId();
  const fineHintId = useId();
  const alloyHintId = useId();

  const [metal, setMetal] = useState<MetalKey>("silver-925");
  const [color, setColor] = useState<GoldColor>("yellow");
  const [wax, setWax] = useState("");
  const [density, setDensity] = useState(() => String(defaultsFor("silver-925").density));
  const [fineness, setFineness] = useState(() => String(defaultsFor("silver-925").fineness));
  const [allowancePercent, setAllowancePercent] = useState(DEFAULT_ALLOWANCE_PERCENT);
  const [recycled, setRecycled] = useState("");
  const [fineMaterialId, setFineMaterialId] = useState("");
  const [alloyMaterialId, setAlloyMaterialId] = useState("");
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");

  const gold = isGoldMetal(metal);
  const fineKind = fineKindFor(metal);

  // Picking a metal (or a gold color) refills the table's density and
  // fineness; whatever the jeweler types afterwards is kept.
  function handleMetalChange(value: string) {
    const next = METAL_KEYS.find((key) => key === value);
    if (!next) return;

    const defaults = defaultsFor(next, color);
    setMetal(next);
    setDensity(String(defaults.density));
    setFineness(String(defaults.fineness));
    // The fine metal comes from a different kind of material for silver than
    // for gold; a pick made for the other kind is no longer on the list.
    if (fineKindFor(next) !== fineKind) {
      setFineMaterialId("");
    }
  }

  function handleColorChange(value: string) {
    const next = GOLD_COLORS.find((candidate) => candidate === value);
    if (!next) return;

    setColor(next);
    setDensity(String(defaultsFor(metal, next).density));
  }

  const figures: Figures = {
    wax: toNumber(wax),
    density: toNumber(density),
    fineness: toNumber(fineness),
    allowance: toNumber(allowancePercent) / 100,
    recycled: recycled.trim() === "" ? 0 : Number(recycled),
  };
  const calculation =
    wax.trim() === ""
      ? null
      : safeCalculateCasting({
          waxGrams: figures.wax,
          density: figures.density,
          fineness: figures.fineness,
          allowance: figures.allowance,
          recycledGrams: figures.recycled,
        });
  const steps = calculation?.ok ? describeSteps(figures, calculation.value) : null;

  const needFine = calculation?.ok ? calculation.value.fine : 0;
  const needAlloy = calculation?.ok ? calculation.value.alloy : 0;
  const fineOptions = materials.filter((material) => material.kind === fineKind);
  const alloyOptions = materials.filter((material) => material.kind === "alloy");
  const fineMaterial = fineOptions.find((material) => material.id === fineMaterialId);
  const alloyMaterial = alloyOptions.find((material) => material.id === alloyMaterialId);
  // Compared in whole hundredths of a gram: no floating-point slack.
  const fineShort =
    fineMaterial !== undefined &&
    toHundredths(fineMaterial.stock) < toHundredths(needFine);
  const alloyShort =
    alloyMaterial !== undefined &&
    toHundredths(alloyMaterial.stock) < toHundredths(needAlloy);

  // Why "Registrar vaciado" is disabled, in words. A disabled button with no
  // explanation is a dead end.
  let blockedReason: string | null = null;
  if (calculation === null || !calculation.ok) {
    blockedReason = "Completa el cálculo para poder registrarlo.";
  } else if (needFine > 0 && !fineMaterial) {
    blockedReason = "Elige el material del que se descuenta el fino.";
  } else if (needAlloy > 0 && !alloyMaterial) {
    blockedReason = "Elige el material del que se descuenta la liga.";
  } else if (fineShort || alloyShort) {
    blockedReason = "Las existencias no alcanzan; registra una compra o ajusta el inventario.";
  }

  function handleRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || blockedReason !== null) return;

    submit(event.currentTarget, () => {
      setWax("");
      setRecycled("");
      setFineMaterialId("");
      setAlloyMaterialId("");
      setDate(today);
      setNote("");
    });
  }

  return (
    <div>
      <div className="grid gap-10 lg:grid-cols-2">
        <div className="flex flex-col gap-5">
          <h2 className={LABEL_CLASS}>Datos del vaciado</h2>

          <div className="grid gap-5 sm:grid-cols-2">
            <label className={FIELD_CLASS}>
              <span className={LABEL_CLASS}>Metal y ley</span>
              <select
                value={metal}
                onChange={(event) => handleMetalChange(event.target.value)}
                className={SELECT_CLASS}
              >
                {METAL_KEYS.map((key) => (
                  <option key={key} value={key}>
                    {METAL_PRESETS[key].label}
                  </option>
                ))}
              </select>
            </label>

            {gold ? (
              <label className={FIELD_CLASS}>
                <span className={LABEL_CLASS}>Color del oro</span>
                <select
                  value={color}
                  onChange={(event) => handleColorChange(event.target.value)}
                  className={SELECT_CLASS}
                >
                  {GOLD_COLORS.map((option) => (
                    <option key={option} value={option}>
                      {GOLD_COLOR_LABELS[option]}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <label className={FIELD_CLASS}>
              <span className={LABEL_CLASS}>Peso de cera (g)</span>
              <input
                type="number"
                min="0"
                step="any"
                inputMode="decimal"
                value={wax}
                onChange={(event) => setWax(event.target.value)}
                className={INPUT_CLASS}
              />
            </label>

            <label className={FIELD_CLASS}>
              <span className={LABEL_CLASS}>Metal reciclado (g)</span>
              <input
                type="number"
                min="0"
                step="any"
                inputMode="decimal"
                placeholder="0"
                value={recycled}
                onChange={(event) => setRecycled(event.target.value)}
                className={INPUT_CLASS}
              />
            </label>

            <label className={FIELD_CLASS}>
              <span className={LABEL_CLASS}>Densidad (g/cm³)</span>
              <input
                type="number"
                min="0"
                step="any"
                inputMode="decimal"
                value={density}
                onChange={(event) => setDensity(event.target.value)}
                className={INPUT_CLASS}
              />
            </label>

            <label className={FIELD_CLASS}>
              <span className={LABEL_CLASS}>Ley (fino de 0 a 1)</span>
              <input
                type="number"
                min="0"
                max="1"
                step="any"
                inputMode="decimal"
                value={fineness}
                onChange={(event) => setFineness(event.target.value)}
                className={INPUT_CLASS}
              />
            </label>

            <label className={FIELD_CLASS}>
              <span className={LABEL_CLASS}>Bebedero (%)</span>
              <input
                type="number"
                min="0"
                max="100"
                step="any"
                inputMode="decimal"
                value={allowancePercent}
                onChange={(event) => setAllowancePercent(event.target.value)}
                className={INPUT_CLASS}
              />
            </label>
          </div>
        </div>

        <div>
          <ResultsPanel calculation={calculation} />
          <FormulaSteps steps={steps} />
        </div>
      </div>

      <form
        onSubmit={handleRegister}
        aria-busy={pending}
        aria-labelledby="registrar-vaciado"
        className="mt-12 flex flex-col gap-5 border-t border-line pt-10"
      >
        <h2
          id="registrar-vaciado"
          className="font-display text-2xl leading-tight text-ink"
        >
          Registrar vaciado
        </h2>
        <p className="max-w-prose text-sm leading-relaxed text-graphite">
          Descuenta el fino y la liga de tus existencias y guarda este cálculo.
          El servidor lo vuelve a calcular con estos datos.
        </p>

        {/* The raw inputs ride along; the server recomputes from them. */}
        <input type="hidden" name="metal" value={metal} />
        {gold ? <input type="hidden" name="color" value={color} /> : null}
        <input type="hidden" name="waxGrams" value={wax} />
        <input type="hidden" name="density" value={density} />
        <input type="hidden" name="fineness" value={fineness} />
        <input type="hidden" name="allowancePercent" value={allowancePercent} />
        <input type="hidden" name="recycledGrams" value={recycled} />

        {materialsUnavailable ? (
          <p role="alert" className={NOTICE_ERROR_CLASS}>
            No pudimos cargar tus materiales. Puedes calcular, pero no
            registrar. Recarga la página para intentarlo de nuevo.
          </p>
        ) : fineOptions.length === 0 || alloyOptions.length === 0 ? (
          <p className="max-w-prose text-sm leading-relaxed text-graphite">
            Para registrar vaciados necesitas un material de{" "}
            {MATERIAL_KIND_LABELS[fineKind].toLowerCase()} y uno de liga con
            existencias. Créalos en{" "}
            <Link href="/admin/inventario" className={LINK_CLASS}>
              Inventario
            </Link>{" "}
            y registra su compra en{" "}
            <Link href="/admin/inversiones" className={LINK_CLASS}>
              Inversiones
            </Link>
            .
          </p>
        ) : null}

        <div className="grid gap-5 sm:grid-cols-2">
          <div className={FIELD_CLASS}>
            <label className={FIELD_CLASS}>
              <span className={LABEL_CLASS}>
                Descontar fino de ({MATERIAL_KIND_LABELS[fineKind]})
              </span>
              <select
                name="fineMaterialId"
                value={fineMaterialId}
                onChange={(event) => setFineMaterialId(event.target.value)}
                aria-describedby={fineHintId}
                disabled={pending}
                className={SELECT_CLASS}
              >
                <option value="">Elige un material</option>
                {fineOptions.map((material) => (
                  <option key={material.id} value={material.id}>
                    {material.name} · {formatGrams(material.stock)}
                  </option>
                ))}
              </select>
            </label>
            <p id={fineHintId} className="text-sm text-graphite">
              {needFine > 0
                ? fineShort
                  ? `Necesitas ${formatGrams(needFine)} y solo hay ${formatGrams(fineMaterial?.stock ?? 0)}.`
                  : `Se descontarán ${formatGrams(needFine)}.`
                : "No se necesita fino."}
            </p>
          </div>

          <div className={FIELD_CLASS}>
            <label className={FIELD_CLASS}>
              <span className={LABEL_CLASS}>Descontar liga de</span>
              <select
                name="alloyMaterialId"
                value={alloyMaterialId}
                onChange={(event) => setAlloyMaterialId(event.target.value)}
                aria-describedby={alloyHintId}
                disabled={pending}
                className={SELECT_CLASS}
              >
                <option value="">Elige un material</option>
                {alloyOptions.map((material) => (
                  <option key={material.id} value={material.id}>
                    {material.name} · {formatGrams(material.stock)}
                  </option>
                ))}
              </select>
            </label>
            <p id={alloyHintId} className="text-sm text-graphite">
              {needAlloy > 0
                ? alloyShort
                  ? `Necesitas ${formatGrams(needAlloy)} y solo hay ${formatGrams(alloyMaterial?.stock ?? 0)}.`
                  : `Se descontarán ${formatGrams(needAlloy)}.`
                : "No se necesita liga."}
            </p>
          </div>

          <label className={FIELD_CLASS}>
            <span className={LABEL_CLASS}>Fecha</span>
            <input
              type="date"
              name="date"
              required
              max={today}
              value={date}
              onChange={(event) => setDate(event.target.value)}
              disabled={pending}
              className={INPUT_CLASS}
            />
          </label>

          <label className={FIELD_CLASS}>
            <span className={LABEL_CLASS}>Nota (opcional)</span>
            <input
              type="text"
              name="note"
              maxLength={300}
              autoComplete="off"
              placeholder="Anillo para pedido de…"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              disabled={pending}
              className={INPUT_CLASS}
            />
          </label>
        </div>

        {blockedReason ? (
          <p id={blockedId} className="text-sm leading-relaxed text-graphite">
            {blockedReason}
          </p>
        ) : null}

        <FormNotice
          result={result}
          successText="Vaciado registrado. Las existencias se actualizaron."
        />

        <button
          type="submit"
          disabled={pending || blockedReason !== null}
          aria-describedby={blockedReason ? blockedId : undefined}
          className={cn(PRIMARY_BUTTON_CLASS, "self-start")}
        >
          {pending ? "Registrando…" : "Registrar vaciado"}
        </button>
      </form>
    </div>
  );
}
