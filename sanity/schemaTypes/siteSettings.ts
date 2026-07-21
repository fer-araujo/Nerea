import { defineField, defineType } from "sanity";

// Site-wide branding singleton — see sanity.config.ts's Studio structure for
// the singleton guard (a fixed document ID "siteSettings", with create/
// delete/duplicate all blocked). Every field here is optional: the
// storefront must render its own built-in placeholders correctly before the
// artisan ever opens Studio — lib/site-settings/adapter.ts degrades to
// null/undefined fields whenever this document doesn't exist yet.
export const siteSettings = defineType({
  name: "siteSettings",
  title: "Ajustes del sitio",
  type: "document",
  fields: [
    defineField({
      name: "logo",
      title: "Logotipo",
      description:
        "El logotipo de la marca (SVG o PNG). Se usa en el encabezado del sitio. Si se deja vacío, se usa el logotipo de referencia.",
      type: "image",
      options: {
        hotspot: true,
        accept: "image/svg+xml,image/png",
      },
    }),
    defineField({
      name: "heroMedia",
      title: "Imagen o video de portada",
      description:
        "Foto, video o GIF de fondo para la portada del sitio (un solo elemento). Si se deja vacío, se usa una imagen de referencia.",
      type: "array",
      of: [
        { type: "image", options: { hotspot: true } },
        {
          type: "file",
          title: "Video o GIF",
          options: { accept: "video/*,image/gif" },
        },
      ],
      validation: (rule) => rule.max(1),
    }),
    defineField({
      name: "heroAlt",
      title: "Texto alternativo de la portada",
      description:
        "Describe la imagen o video de portada para lectores de pantalla (opcional).",
      type: "object",
      fields: [
        defineField({ name: "es", title: "Español", type: "string" }),
        defineField({ name: "en", title: "English", type: "string" }),
      ],
    }),
  ],
  preview: {
    select: { media: "logo" },
    prepare({ media }) {
      return { title: "Ajustes del sitio", media };
    },
  },
});
