import { defineField, defineType } from "sanity";
import { DEFAULT_RING_SIZES } from "../../lib/commerce/options";
import { validateWhatsappNumberInput } from "../../lib/site-settings/whatsapp";

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
    // Commerce defaults, edited once here instead of per piece. A piece can
    // still carry its own list (see sanity/schemaTypes/product.ts); the
    // storefront falls back to built-in values when these are left empty.
    defineField({
      name: "ringSizes",
      title: "Tallas de anillo (predeterminadas)",
      description:
        "Tallas que se ofrecen en las piezas con opción de talla de anillo, salvo que la pieza tenga su propia lista. Si se deja vacío, se ofrecen de la 4 a la 13 en medias tallas.",
      type: "array",
      of: [{ type: "string" }],
      options: {
        list: DEFAULT_RING_SIZES.map((size) => ({ title: size, value: size })),
        layout: "grid",
      },
      validation: (rule) => rule.unique(),
    }),
    defineField({
      name: "chainLengths",
      title: "Largos de cadena (predeterminados)",
      description:
        "Largos que se ofrecen en las piezas con opción de largo de cadena, salvo que la pieza tenga su propia lista. El costo extra se suma al precio de la pieza. Si se deja vacío, se ofrecen 40, 45 y 50 cm sin costo extra.",
      type: "array",
      of: [{ type: "chainLengthOption" }],
    }),
    // Same unit and input convention as `product.price.amount`: centavos, no
    // decimals. Read server-side only, by checkoutAction (never the client).
    // The 100000 ($1,000.00 MXN) ceiling is a typo guard for a flat domestic
    // rate (an extra zero would otherwise charge every order 10x), not a
    // business rule.
    defineField({
      name: "shippingFee",
      title: "Costo de envío (en centavos, sin decimales)",
      description:
        "Tarifa fija de envío dentro de México. Ejemplo: $150.00 MXN se escribe como 15000. Usa 0 (o déjalo vacío) para ofrecer envío gratis. Máximo: $1,000.00 MXN (100000).",
      type: "number",
      initialValue: 0,
      validation: (rule) => rule.integer().min(0).max(100000),
    }),
    // Public contact number behind the "Escríbenos por WhatsApp" links (checkout
    // success page, contact page, cart footer while payments are off). Optional:
    // left empty, those links simply do not render. Digits only because that is
    // what wa.me takes; lib/site-settings/whatsapp.ts normalizes it again on read,
    // so a document edited outside Studio cannot produce a broken link.
    defineField({
      name: "whatsappNumber",
      title: "Número de WhatsApp",
      description: "Con lada de país, solo dígitos, p. ej. 5215512345678",
      type: "string",
      validation: (rule) => rule.custom(validateWhatsappNumberInput),
    }),
  ],
  preview: {
    select: { media: "logo" },
    prepare({ media }) {
      return { title: "Ajustes del sitio", media };
    },
  },
});
