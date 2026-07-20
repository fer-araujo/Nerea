import { defineField, defineType } from "sanity";

// Inbound contact-form submissions (lib/contact/submit.ts writes these
// through a server-only token — see sanity.config.ts's Studio structure for
// the "no manual create" guard: the artisan reads inquiries here, she never
// authors them from Studio). `createdAt` is set server-side at write time —
// see lib/contact/submit.ts — never a client-supplied timestamp. Fields are
// `readOnly` in the Studio UI as a light integrity signal (a received
// message shouldn't be silently edited); this is a UI annotation only, not
// a real permission — actual write access is enforced by the dataset/token
// configuration itself.
export const contactMessage = defineType({
  name: "contactMessage",
  title: "Mensaje de contacto",
  type: "document",
  fields: [
    defineField({
      name: "name",
      title: "Nombre",
      type: "string",
      readOnly: true,
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "email",
      title: "Correo",
      type: "string",
      readOnly: true,
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "message",
      title: "Mensaje",
      type: "text",
      readOnly: true,
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "createdAt",
      title: "Recibido",
      type: "datetime",
      readOnly: true,
    }),
  ],
  orderings: [
    {
      title: "Más reciente primero",
      name: "createdAtDesc",
      by: [{ field: "createdAt", direction: "desc" }],
    },
  ],
  preview: {
    select: { title: "name", subtitle: "email" },
  },
});
