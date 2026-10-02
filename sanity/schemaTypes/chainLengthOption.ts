import { defineField, defineType } from "sanity";

// One selectable chain length. Registered once as a named object type and
// reused by both `product.chainLengths` (per-piece override) and
// `siteSettings.chainLengths` (the defaults), so the two lists can never drift
// apart in shape or Studio wording.
export const chainLengthOption = defineType({
  name: "chainLengthOption",
  title: "Largo de cadena",
  type: "object",
  fields: [
    defineField({
      name: "lengthCm",
      title: "Largo (en centímetros)",
      description: "Ejemplo: 45 para una cadena de 45 cm.",
      type: "number",
      validation: (rule) => rule.required().positive(),
    }),
    // Same unit and input convention as `product.price.amount`: centavos, no
    // decimals (see sanity/schemaTypes/product.ts).
    defineField({
      name: "extraPrice",
      title: "Costo extra (en centavos, sin decimales)",
      description:
        "Se suma al precio de la pieza. Ejemplo: $150.00 MXN se escribe como 15000. Usa 0 si este largo no cuesta extra.",
      type: "number",
      initialValue: 0,
      validation: (rule) => rule.required().integer().min(0),
    }),
  ],
  preview: {
    select: { lengthCm: "lengthCm", extraPrice: "extraPrice" },
    prepare({ lengthCm, extraPrice }) {
      return {
        title: lengthCm ? `${lengthCm} cm` : "Largo sin definir",
        subtitle:
          typeof extraPrice === "number" && extraPrice > 0
            ? `+$${(extraPrice / 100).toFixed(2)} MXN`
            : "Sin costo extra",
      };
    },
  },
});
