import { defineField, defineType } from "sanity";
import { DEFAULT_RING_SIZES } from "../../lib/commerce/options";

// One document per physical piece (one-of-one model, see design.md ADR-2 /
// Commerce Data Layer). Title/description are field-level bilingual objects
// rather than separate per-language documents, so availability, price, and
// images can never drift between the two languages of the same object.
export const product = defineType({
  name: "product",
  title: "Pieza",
  type: "document",
  fields: [
    defineField({
      name: "title",
      title: "Título",
      description: "Nombre de la pieza en cada idioma.",
      type: "object",
      fields: [
        defineField({
          name: "es",
          title: "Español",
          type: "string",
          validation: (rule) => rule.required(),
        }),
        defineField({
          name: "en",
          title: "English",
          type: "string",
        }),
      ],
    }),
    defineField({
      name: "description",
      title: "Descripción",
      description: "Historia y detalles de la pieza en cada idioma.",
      type: "object",
      fields: [
        defineField({
          name: "es",
          title: "Español",
          type: "text",
          validation: (rule) => rule.required(),
        }),
        defineField({
          name: "en",
          title: "English",
          type: "text",
        }),
      ],
    }),
    defineField({
      name: "slug",
      title: "URL (slug)",
      description:
        "Se genera a partir del título en español. No lo edites a mano salvo que sepas lo que haces.",
      type: "slug",
      options: { source: "title.es", maxLength: 96 },
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "category",
      title: "Categoría",
      description: "Categoría de la pieza (opcional).",
      type: "reference",
      to: [{ type: "category" }],
    }),
    defineField({
      name: "media",
      title: "Galería",
      description:
        "Fotos y videos de la pieza. El primer elemento es el que aparece en el catálogo.",
      type: "array",
      of: [
        { type: "image", options: { hotspot: true } },
        {
          type: "file",
          title: "Video o GIF",
          options: { accept: "video/*,image/gif" },
        },
      ],
      validation: (rule) => rule.min(1),
    }),
    defineField({
      name: "price",
      title: "Precio",
      type: "object",
      fields: [
        defineField({
          name: "amount",
          title: "Monto (en centavos, sin decimales)",
          description: 'Ejemplo: $1,850.00 MXN se escribe como 185000.',
          type: "number",
          validation: (rule) => rule.required().integer().positive(),
        }),
        defineField({
          name: "currency",
          title: "Moneda",
          description: "Por ahora solo manejamos pesos mexicanos (MXN).",
          type: "string",
          initialValue: "MXN",
        }),
      ],
    }),
    // What the shopper must pick before paying. The two lists below are
    // OPTIONAL per-piece overrides: left empty, the storefront uses the
    // defaults in "Ajustes del sitio" (and, failing that, built-in ones) —
    // see lib/commerce/options.ts for the resolution order.
    defineField({
      name: "purchaseOption",
      title: "Opción de compra",
      description:
        "Lo que debe elegir quien compra antes de pagar. Los anillos piden talla; los dijes con cadena piden el largo.",
      type: "string",
      options: {
        list: [
          { title: "Ninguna", value: "none" },
          { title: "Talla de anillo", value: "ringSize" },
          { title: "Largo de cadena", value: "chainLength" },
        ],
        layout: "radio",
      },
      initialValue: "none",
    }),
    defineField({
      name: "ringSizes",
      title: "Tallas disponibles (opcional)",
      description:
        'Marca solo las tallas que ofreces en esta pieza. Si lo dejas vacío, se usan las tallas de "Ajustes del sitio".',
      type: "array",
      of: [{ type: "string" }],
      options: {
        list: DEFAULT_RING_SIZES.map((size) => ({ title: size, value: size })),
        layout: "grid",
      },
      validation: (rule) => rule.unique(),
      hidden: ({ document }) => document?.purchaseOption !== "ringSize",
    }),
    defineField({
      name: "chainLengths",
      title: "Largos de cadena disponibles (opcional)",
      description:
        'Largos que ofreces en esta pieza, cada uno con su costo extra. Si lo dejas vacío, se usan los largos de "Ajustes del sitio".',
      type: "array",
      of: [{ type: "chainLengthOption" }],
      hidden: ({ document }) => document?.purchaseOption !== "chainLength",
    }),
    defineField({
      name: "status",
      title: "Disponibilidad",
      description:
        'Marca "Vendida" en cuanto se venda la pieza — no hay reposición.',
      type: "string",
      options: {
        list: [
          { title: "Disponible", value: "available" },
          { title: "Vendida", value: "sold" },
        ],
        layout: "radio",
      },
      initialValue: "available",
      validation: (rule) => rule.required(),
    }),
  ],
  preview: {
    select: { title: "title.es", media: "media.0", status: "status" },
    prepare({ title, media, status }) {
      return {
        title,
        subtitle: status === "sold" ? "Vendida" : "Disponible",
        media,
      };
    },
  },
});
