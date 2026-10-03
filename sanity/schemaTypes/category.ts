import { defineField, defineType } from "sanity";

// Optional classification for a product (see product.ts's `category`
// reference field). Kept deliberately small — a name + a slug — since its
// jobs are labeling a piece, driving the shop's category filter chips
// (components/shop/CategoryFilter.tsx) and, through `purchaseOption`, setting
// the default choice every piece in the category asks the shopper for; it
// carries no imagery or description of its own.
export const category = defineType({
  name: "category",
  title: "Categoría",
  type: "document",
  fields: [
    defineField({
      name: "title",
      title: "Nombre",
      description: "Nombre de la categoría en cada idioma.",
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
      name: "slug",
      title: "URL (slug)",
      description:
        "Se genera a partir del nombre en español. No lo edites a mano salvo que sepas lo que haces.",
      type: "slug",
      options: { source: "title.es", maxLength: 96 },
      validation: (rule) => rule.required(),
    }),
    // The default for every piece in this category whose own "Opción de compra"
    // is "Según la categoría" (or was never set — every piece created before
    // that field existed). A piece can still pick its own, "Ninguna" included.
    // Same three values as product.ts's field; resolved in
    // lib/commerce/options.ts (`resolveProductOptions`).
    defineField({
      name: "purchaseOption",
      title: "Opción de compra",
      description:
        "Se aplica a todas las piezas de esta categoría, salvo que la pieza indique otra",
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
  ],
  preview: {
    select: { title: "title.es" },
  },
});
