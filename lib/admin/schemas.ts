import "server-only";
import { z } from "zod";
import { DOCUMENT_ID_PATTERN, isPieceHandle } from "@/lib/admin/data/shared";
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
import { MAX_SALE_ITEMS } from "@/lib/admin/domain/sales";

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

/** A catalog handle: the key of a piece's cost document, so it must be a safe id. */
function pieceHandle(label: string) {
  return z
    .string({ error: `${label}: elige una pieza.` })
    .refine((value) => isPieceHandle(value), {
      error: `${label}: elige una pieza válida.`,
    });
}

// A blank text field means "not provided".
function blankAsMissing(value: unknown): unknown {
  return typeof value === "string" && value.trim() === "" ? undefined : value;
}

/** Pesos, optional: a blank field is `undefined`, anything else must be valid. */
function optionalMoneyText(label: string, options: { max: number }) {
  return z.preprocess(blankAsMissing, moneyText(label, options).optional());
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

// ---- piezas ------------------------------------------------------------

/** Ceiling for any single cost of a piece, in pesos. */
const MAX_PIECE_COST_PESOS = 10_000_000;

export const savePieceCostSchema = z
  .object({
    handle: pieceHandle("Pieza"),
    // Blank = not provided; metal, stones and other then count as 0 and labor
    // as absent. At least one must be typed, so an accidental empty save can't
    // record a piece as free to make.
    metal: optionalMoneyText("Metal", { max: MAX_PIECE_COST_PESOS }),
    stones: optionalMoneyText("Piedras", { max: MAX_PIECE_COST_PESOS }),
    other: optionalMoneyText("Otros", { max: MAX_PIECE_COST_PESOS }),
    labor: optionalMoneyText("Mano de obra", { max: MAX_PIECE_COST_PESOS }),
    // What "Calcular metal" used; informational, stored beside the cost.
    metalGrams: z.preprocess(
      blankAsMissing,
      positiveDecimal("Gramos de metal", { maxDecimals: 3, max: 100_000 }).optional(),
    ),
    materialId: optionalDocumentId("Material"),
    note: optionalText("Nota", 300),
  })
  .refine(
    (value) =>
      [value.metal, value.stones, value.other, value.labor].some(
        (cost) => cost !== undefined,
      ),
    {
      path: ["metal"],
      error: "Costos: escribe al menos un costo (puede ser 0).",
    },
  )
  .transform(
    ({ handle, metal, stones, other, labor, metalGrams, materialId, note }) => ({
      handle,
      costs: {
        metal: metal ?? 0,
        stones: stones ?? 0,
        other: other ?? 0,
        ...(labor !== undefined ? { labor } : {}),
      },
      ...(metalGrams !== undefined ? { metalGrams } : {}),
      ...(materialId !== undefined ? { materialId } : {}),
      ...(note !== undefined ? { note } : {}),
    }),
  );

// ---- ventas ------------------------------------------------------------

const saleItemSchema = z.object({
  handle: pieceHandle("Pieza"),
  // Editable on purpose (a discount), so it is validated like any amount; the
  // catalog price is only the form's starting value.
  price: moneyText("Precio", { max: MAX_PIECE_COST_PESOS }),
  option: optionalText("Opción", 60),
});

export const recordManualSaleSchema = z
  .object({
    date: dateText("Fecha"),
    // Optional: blank, or not sent at all, means no shipping was charged.
    shipping: z.preprocess(
      (value) =>
        value === undefined || (typeof value === "string" && value.trim() === "")
          ? "0"
          : value,
      moneyText("Envío", { max: 100_000 }),
    ),
    // The terminal's commission, optional like the shipping: blank, or not sent
    // at all, means none (cash, or a sale without a terminal).
    terminalFee: z.preprocess(
      (value) =>
        value === undefined || (typeof value === "string" && value.trim() === "")
          ? "0"
          : value,
      moneyText("Comisión", { max: 100_000 }),
    ),
    note: optionalText("Nota", 300),
    markSold: z.boolean(),
    items: z
      .array(saleItemSchema, { error: "Agrega al menos una pieza." })
      .min(1, { error: "Agrega al menos una pieza." })
      .max(MAX_SALE_ITEMS, {
        error: `Máximo ${MAX_SALE_ITEMS} piezas por venta.`,
      }),
  })
  .refine(
    (value) =>
      new Set(value.items.map((item) => item.handle)).size === value.items.length,
    {
      path: ["items"],
      error: "Una pieza no puede repetirse en la misma venta.",
    },
  );

export const voidSaleSchema = z.object({
  saleId: documentId("Venta"),
});

// "Actualizar comisión" names a sale and nothing else: the session id it asks
// Stripe about is read from the stored sale, never from the request.
export const refreshSaleFeeSchema = z.object({
  saleId: documentId("Venta"),
});
