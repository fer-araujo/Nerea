import { defineField, defineType } from "sanity";

// A themed or seasonal grouping of pieces that cuts ACROSS categories (e.g. a
// temporary "Día de Muertos" collection mixing rings, earrings, pendants and
// bracelets). A piece has one category and any number of collections — the
// membership lives on the piece (product.ts's `collections` field), so a
// collection never has to list its pieces by hand.
//
// Visible on the storefront only while `active` is on AND `endsAt` is empty or
// still in the future. The rule is applied in GROQ (lib/commerce/sanity/
// queries.ts), so a closed collection drops out of the shop's filter, the
// collections index, the sitemap and its own page (a 404) without anyone having
// to switch it off by hand; `active` is the manual off-switch.
export const collection = defineType({
  name: "collection",
  title: "Colección",
  type: "document",
  fields: [
    defineField({
      name: "title",
      title: "Nombre",
      description: "Nombre de la colección en cada idioma.",
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
    defineField({
      name: "description",
      title: "Descripción",
      description:
        "Texto que acompaña a la colección en su página, en cada idioma (opcional).",
      type: "object",
      fields: [
        defineField({ name: "es", title: "Español", type: "text" }),
        defineField({ name: "en", title: "English", type: "text" }),
      ],
    }),
    // Optional hero image. When one is set, its alt text (Spanish at least) is
    // required: the image carries meaning on the collection page and a missing
    // description would leave it unnamed for screen readers.
    defineField({
      name: "cover",
      title: "Imagen de portada (opcional)",
      description:
        "Imagen que encabeza la página de la colección. Si la agregas, escribe también su texto alternativo.",
      type: "image",
      options: { hotspot: true },
      fields: [
        defineField({
          name: "alt",
          title: "Texto alternativo",
          description:
            "Describe la imagen para lectores de pantalla. Obligatorio si hay imagen.",
          type: "object",
          fields: [
            defineField({ name: "es", title: "Español", type: "string" }),
            defineField({ name: "en", title: "English", type: "string" }),
          ],
        }),
      ],
      validation: (rule) =>
        rule.custom((value) => {
          const cover = value as
            | { asset?: unknown; alt?: { es?: string } }
            | undefined;
          if (!cover?.asset) return true;
          return cover.alt?.es?.trim()
            ? true
            : "Agrega el texto alternativo en español de la imagen.";
        }),
    }),
    defineField({
      name: "active",
      title: "Activa",
      description:
        "Desmárcala para ocultar la colección de la tienda sin borrarla.",
      type: "boolean",
      initialValue: true,
    }),
    defineField({
      name: "endsAt",
      title: "Fecha de cierre (opcional)",
      description:
        "Si la indicas, la colección deja de mostrarse en la tienda a partir de esa fecha y hora. Déjala vacía para una colección permanente.",
      type: "datetime",
    }),
    defineField({
      name: "order",
      title: "Orden",
      description:
        "Las colecciones con número menor aparecen primero. Si lo dejas vacío, van al final.",
      type: "number",
      validation: (rule) => rule.integer(),
    }),
  ],
  preview: {
    select: {
      title: "title.es",
      media: "cover",
      active: "active",
      endsAt: "endsAt",
    },
    prepare({ title, media, active, endsAt }) {
      const closed = Boolean(endsAt) && new Date(endsAt).getTime() <= Date.now();
      return {
        title,
        subtitle: !active ? "Oculta" : closed ? "Cerrada" : "Visible",
        media,
      };
    },
  },
});
