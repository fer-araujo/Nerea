import { defineField, defineType } from "sanity";
import {
  DEFAULT_RING_SIZES,
  INHERIT_PURCHASE_OPTION,
} from "../../lib/commerce/options";

// The slug is the piece's handle everywhere: the URL, the cart, the Stripe
// metadata (comma- and semicolon-separated lists) and the stock markers. A
// hand-typed slug with a comma, a space or an accent would break those lists,
// so only lowercase letters, digits and hyphens are accepted.
export const SLUG_PATTERN = /^[a-z0-9-]+$/;
export const SLUG_ERROR =
  "El slug solo puede llevar letras minúsculas sin acentos, números y guiones (sin espacios, comas ni otros símbolos).";

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
      validation: (rule) =>
        rule.required().custom((value) => {
          const current = (value as { current?: unknown } | undefined)?.current;
          // A missing slug is `required()`'s to report, not this rule's.
          if (typeof current !== "string" || current === "") return true;
          return SLUG_PATTERN.test(current) || SLUG_ERROR;
        }),
    }),
    defineField({
      name: "category",
      title: "Categoría",
      description: "Categoría de la pieza (opcional).",
      type: "reference",
      to: [{ type: "category" }],
    }),
    // Many-to-many, unlike `category`: a piece can sit in several collections at
    // once (e.g. "Día de Muertos" and "Plata .925"). Only collections that are
    // active and not past their closing date are shown on the storefront, so a
    // reference to a closed one is harmless and does not need cleaning up.
    defineField({
      name: "collections",
      title: "Colecciones",
      description:
        "Colecciones a las que pertenece la pieza (opcional). Puede estar en varias.",
      type: "array",
      of: [{ type: "reference", to: [{ type: "collection" }] }],
      validation: (rule) => rule.unique(),
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
    // What the shopper must pick before paying. "Según la categoría" (the
    // default) takes the choice from the piece's category (category.ts), which
    // is also what a piece with no value at all does — every document created
    // before this option existed; the three explicit values override it, "Ninguna"
    // included. The two lists below are OPTIONAL per-piece overrides of the
    // VALUES: left empty, the storefront uses the defaults in "Ajustes del sitio"
    // (and, failing that, built-in ones) — see lib/commerce/options.ts for both
    // resolution orders.
    defineField({
      name: "purchaseOption",
      title: "Opción de compra",
      description:
        'Lo que debe elegir quien compra antes de pagar. Los anillos piden talla; los dijes con cadena piden el largo. "Según la categoría" usa la opción que tenga la categoría de la pieza.',
      type: "string",
      options: {
        list: [
          { title: "Según la categoría", value: INHERIT_PURCHASE_OPTION },
          { title: "Ninguna", value: "none" },
          { title: "Talla de anillo", value: "ringSize" },
          { title: "Largo de cadena", value: "chainLength" },
        ],
        layout: "radio",
      },
      initialValue: INHERIT_PURCHASE_OPTION,
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
    // How many units of this design can be sold. 1 (the default) is the
    // one-of-one model; a design made in several copies raises it. It drops on
    // its own with every sale (the Stripe webhook and the manual sale decrement
    // it) and is what the storefront reads. A document that predates the field
    // has no value: the storefront then falls back to `status` (see
    // lib/commerce/transforms.ts `toStock`).
    defineField({
      name: "stock",
      title: "Piezas disponibles",
      description:
        "1 = pieza única. Súbelo si haces más de una; llega a 0 sola al venderse.",
      type: "number",
      initialValue: 1,
      validation: (rule) => rule.required().integer().min(0),
    }),
    // Legacy flag, kept in sync by the sale paths (stock 0 -> "sold"). Read-only
    // in Studio: the number of pieces above is what the artisan edits, and the
    // storefront reads `stock` first.
    defineField({
      name: "status",
      title: "Estado (automático)",
      description:
        "Se mantiene solo: pasa a «Vendida» cuando se acaban las piezas. No lo edites; cambia las piezas disponibles.",
      type: "string",
      options: {
        list: [
          { title: "Disponible", value: "available" },
          { title: "Vendida", value: "sold" },
        ],
        layout: "radio",
      },
      initialValue: "available",
      readOnly: true,
    }),
  ],
  preview: {
    select: {
      title: "title.es",
      media: "media.0",
      status: "status",
      stock: "stock",
    },
    prepare({ title, media, status, stock }) {
      // `stock` first, `status` for a document that predates it: the same rule
      // the storefront applies.
      const pieces =
        typeof stock === "number" ? stock : status === "available" ? 1 : 0;
      return {
        title,
        subtitle:
          pieces <= 0
            ? "Agotada"
            : pieces === 1
              ? "1 pieza disponible"
              : `${pieces} piezas disponibles`,
        media,
      };
    },
  },
});
