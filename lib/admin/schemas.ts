import "server-only";
import { z } from "zod";
import { DOCUMENT_ID_PATTERN } from "@/lib/admin/data/shared";
import {
  GOLD_COLORS,
  METAL_KEYS,
  isGoldMetal,
} from "@/lib/admin/domain/casting";
import {
  ADJUSTMENT_KINDS,
  MATERIAL_KINDS,
  MAX_PURCHASE_ITEMS,
} from "@/lib/admin/domain/inventory";
import { pesosToCentavos } from "@/lib/admin/domain/money";
import {
  mexicoDateToInstant,
  mexicoTodayIso,
  parseIsoDate,
} from "@/lib/admin/domain/periods";
import { MATERIAL_UNITS } from "@/lib/admin/domain/quantity";

// Boundary validation for the inventory Server Actions. A Server Action is a
// public POST endpoint, so nothing in a FormData is trusted: every field is
// parsed here, strictly, BEFORE any data function runs.
//
// FormData values are strings, so decimals arrive as TEXT and are matched
// against an explicit pattern (not `Number(x)` or z.coerce, which turn "" into
// 0 and accept "1e3", "0x10" and " "). Messages are Spanish because they are
// shown to the admin as-is; each one names its field and none echoes the
// value that was typed. Server-only on purpose: zod stays out of the browser
// bundle, the forms rely on native validation and the server is the authority.

const GENERIC_INVALID = "Revisa los datos del formulario.";

/** The sentence to show for the first problem found. */
export function firstIssueMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? GENERIC_INVALID;
}

function decimalText(
  label: string,
  { maxDecimals, signed = false }: { maxDecimals: number; signed?: boolean },
) {
  const pattern = new RegExp(
    `^${signed ? "-?" : ""}\\d{1,9}(?:\\.\\d{1,${maxDecimals}})?$`,
  );
  return z
    .string({ error: `${label}: escribe un número.` })
    .trim()
    .regex(pattern, {
      error: `${label}: escribe un número válido (máximo ${maxDecimals} decimales).`,
    })
    .transform(Number);
}

function positiveDecimal(
  label: string,
  options: { maxDecimals: number; max: number },
) {
  return decimalText(label, options)
    .refine((value) => value > 0, { error: `${label}: debe ser mayor que 0.` })
    .refine((value) => value <= options.max, {
      error: `${label}: el valor es demasiado grande.`,
    });
}

function nonNegativeDecimal(
  label: string,
  options: { maxDecimals: number; max: number },
) {
  return decimalText(label, options).refine((value) => value <= options.max, {
    error: `${label}: el valor es demasiado grande.`,
  });
}

/** Pesos typed as "1234.56" (at most two decimals) -> integer centavos. */
function moneyText(label: string, { max }: { max: number }) {
  return z
    .string({ error: `${label}: escribe un monto en pesos.` })
    .trim()
    .regex(/^\d{1,8}(?:\.\d{1,2})?$/, {
      error: `${label}: escribe un monto válido en pesos (máximo 2 decimales).`,
    })
    .transform((text) => pesosToCentavos(Number(text)))
    .refine((centavos) => centavos <= pesosToCentavos(max), {
      error: `${label}: el monto es demasiado grande.`,
    });
}

function documentId(label: string) {
  return z
    .string({ error: `${label}: elige una opción.` })
    .regex(DOCUMENT_ID_PATTERN, { error: `${label}: elige una opción válida.` });
}

/** An optional id: a missing or blank field means "none chosen". */
function optionalDocumentId(label: string) {
  return z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    documentId(label).optional(),
  );
}

function dateText(label: string) {
  return z
    .string({ error: `${label}: elige una fecha.` })
    .trim()
    .refine((text) => parseIsoDate(text) !== null, {
      error: `${label}: la fecha no es válida.`,
    })
    .refine((text) => text <= mexicoTodayIso(), {
      error: `${label}: no puede ser una fecha futura.`,
    })
    .transform(mexicoDateToInstant);
}

function requiredText(label: string, { min = 1, max }: { min?: number; max: number }) {
  return z
    .string({ error: `${label}: escribe un texto.` })
    .trim()
    .min(min, {
      error:
        min <= 1
          ? `${label}: es obligatorio.`
          : `${label}: escribe al menos ${min} caracteres.`,
    })
    .max(max, { error: `${label}: máximo ${max} caracteres.` });
}

function optionalText(label: string, max: number) {
  return z
    .string()
    .trim()
    .max(max, { error: `${label}: máximo ${max} caracteres.` })
    .transform((text) => (text === "" ? undefined : text))
    .optional();
}

// ---- inventario --------------------------------------------------------

export const createMaterialSchema = z.object({
  name: requiredText("Nombre", { max: 80 }),
  kind: z.enum(MATERIAL_KINDS, { error: "Tipo: elige una opción." }),
  unit: z.enum(MATERIAL_UNITS, { error: "Unidad: elige una opción." }),
});

export const adjustStockSchema = z
  .object({
    materialId: documentId("Material"),
    delta: decimalText("Cantidad", { maxDecimals: 2, signed: true })
      .refine((value) => value !== 0, {
        error: "Cantidad: no puede ser 0.",
      })
      .refine((value) => Math.abs(value) <= 1_000_000, {
        error: "Cantidad: el valor es demasiado grande.",
      }),
    kind: z.enum(ADJUSTMENT_KINDS, { error: "Tipo: elige una opción." }),
    reason: requiredText("Motivo", { min: 3, max: 200 }),
  })
  .refine((value) => value.kind !== "loss" || value.delta < 0, {
    path: ["delta"],
    error: "Cantidad: una merma debe ser negativa.",
  });

// ---- inversiones -------------------------------------------------------

const purchaseItemSchema = z.object({
  materialId: documentId("Material"),
  qty: positiveDecimal("Cantidad", { maxDecimals: 2, max: 1_000_000 }),
  totalCost: moneyText("Costo", { max: 10_000_000 }),
});

export const recordPurchaseSchema = z.object({
  date: dateText("Fecha"),
  supplier: optionalText("Proveedor", 120),
  note: optionalText("Nota", 300),
  items: z
    .array(purchaseItemSchema, { error: "Agrega al menos un material." })
    .min(1, { error: "Agrega al menos un material." })
    .max(MAX_PURCHASE_ITEMS, {
      error: `Máximo ${MAX_PURCHASE_ITEMS} materiales por compra.`,
    }),
});

// ---- calculadora -------------------------------------------------------

export const registerCastingSchema = z
  .object({
    metal: z.enum(METAL_KEYS, { error: "Metal: elige una opción." }),
    color: z.enum(GOLD_COLORS, { error: "Color: elige una opción." }).optional(),
    waxGrams: positiveDecimal("Peso de cera", { maxDecimals: 3, max: 10_000 }),
    density: positiveDecimal("Densidad", { maxDecimals: 3, max: 30 }),
    fineness: positiveDecimal("Ley", { maxDecimals: 6, max: 1 }),
    // Typed as a percentage, stored as a fraction.
    allowancePercent: nonNegativeDecimal("Bebedero", { maxDecimals: 2, max: 100 }),
    // Blank means none.
    recycledGrams: z.preprocess(
      (value) => (typeof value === "string" && value.trim() === "" ? "0" : value),
      nonNegativeDecimal("Metal reciclado", { maxDecimals: 3, max: 10_000 }),
    ),
    fineMaterialId: optionalDocumentId("Material fino"),
    alloyMaterialId: optionalDocumentId("Liga"),
    date: dateText("Fecha"),
    note: optionalText("Nota", 300),
  })
  .refine((value) => !isGoldMetal(value.metal) || value.color !== undefined, {
    path: ["color"],
    error: "Color: elige el color del oro.",
  });
