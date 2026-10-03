import type { CastingErrorCode, CastingField } from "./domain/casting";
import type {
  AdjustmentKind,
  MaterialKind,
  MovementType,
} from "./domain/inventory";
import type { MaterialUnit } from "./domain/quantity";
import type { SaleSource } from "./domain/sales";

// Spanish vocabulary for the admin modules. The panel is a single-language
// surface outside next-intl (see LoginForm), so its copy is plain constants.
// Kept apart from lib/admin/domain so the domain stays technical and English;
// importable from both server and client code (no server-only here).

export const MATERIAL_KIND_LABELS: Readonly<Record<MaterialKind, string>> = {
  fine_silver: "Plata fina",
  fine_gold: "Oro fino",
  alloy: "Liga",
  stone: "Piedra",
  other: "Otro",
};

export const MATERIAL_UNIT_LABELS: Readonly<Record<MaterialUnit, string>> = {
  g: "Gramos (g)",
  pz: "Piezas (pz)",
};

export const MOVEMENT_TYPE_LABELS: Readonly<Record<MovementType, string>> = {
  purchase: "Compra",
  casting: "Vaciado",
  adjustment: "Ajuste",
  loss: "Merma",
};

export const ADJUSTMENT_KIND_LABELS: Readonly<Record<AdjustmentKind, string>> =
  {
    adjustment: "Corrección (suma o resta)",
    loss: "Merma (solo resta)",
  };

export const SALE_SOURCE_LABELS: Readonly<Record<SaleSource, string>> = {
  stripe: "Tienda en línea",
  manual: "Manual",
};

const CASTING_SUBJECTS: Readonly<Record<CastingField, string>> = {
  waxGrams: "El peso de cera",
  density: "La densidad",
  allowance: "El bebedero",
  fineness: "La ley",
  metalGrams: "El metal",
  recycledGrams: "El metal reciclado",
};

const CASTING_OUT_OF_RANGE: Readonly<Partial<Record<CastingField, string>>> = {
  allowance: "El bebedero debe estar entre 0 % y 100 %.",
  fineness: "La ley debe ser mayor que 0 y como máximo 1.",
  recycledGrams: "El metal reciclado no puede ser negativo.",
};

/** Plain-language reason a casting can't be calculated. */
export function castingErrorMessage(error: {
  field: CastingField;
  code: CastingErrorCode;
}): string {
  switch (error.code) {
    case "not-a-number":
      return `${CASTING_SUBJECTS[error.field]}: escribe un número válido.`;
    case "not-positive":
      return `${CASTING_SUBJECTS[error.field]} debe ser mayor que 0.`;
    case "recycled-exceeds-metal":
      return "El metal reciclado no puede ser mayor que el metal total.";
    case "out-of-range":
      return (
        CASTING_OUT_OF_RANGE[error.field] ??
        `${CASTING_SUBJECTS[error.field]} está fuera de rango.`
      );
  }
}
