import { defineField, defineType } from "sanity";

// Optional classification for a product (see product.ts's `category`
// reference field). Kept deliberately small — a name + a slug — since its
// only jobs are labeling a piece and driving the shop's category filter
// chips (components/shop/CategoryFilter.tsx); it carries no imagery or
// description of its own.
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
  ],
  preview: {
    select: { title: "title.es" },
  },
});
