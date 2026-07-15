import { defineField, defineType } from "sanity";

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
      name: "images",
      title: "Fotos",
      description: "La primera foto es la que aparece en el catálogo.",
      type: "array",
      of: [{ type: "image", options: { hotspot: true } }],
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
    select: { title: "title.es", media: "images.0", status: "status" },
    prepare({ title, media, status }) {
      return {
        title,
        subtitle: status === "sold" ? "Vendida" : "Disponible",
        media,
      };
    },
  },
});
