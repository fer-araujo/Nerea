import { defineConfig } from "sanity";
import { structureTool } from "sanity/structure";
import { visionTool } from "@sanity/vision";
import { apiVersion, dataset, projectId } from "./sanity/env";
import { schemaTypes } from "./sanity/schemaTypes";

// Document types that are never freely created/duplicated from Studio:
// - "siteSettings" is a singleton — the structure pane below always opens
//   the one fixed document id "siteSettings" (see lib/site-settings).
// - "contactMessage" is a read-only inbox, written exclusively by
//   lib/contact/submit.ts's server-only write client — the artisan reads
//   inquiries here, she never authors them from Studio.
const NO_CREATE_TYPES = new Set(["siteSettings", "contactMessage"]);

// Embedded Studio config, mounted at /studio (see app/studio/[[...tool]]).
// The artisan's bilingual, image-first admin — see design.md § Commerce
// Data Layer for the one-of-one product schema rationale.
export default defineConfig({
  name: "nerea",
  title: "nerea — Catálogo",
  basePath: "/studio",
  projectId,
  dataset,
  schema: { types: schemaTypes },
  plugins: [
    structureTool({
      structure: (S) =>
        S.list()
          .title("Contenido")
          .items([
            S.listItem()
              .title("Ajustes del sitio")
              .id("siteSettings")
              .child(
                S.document()
                  .schemaType("siteSettings")
                  .documentId("siteSettings"),
              ),
            S.divider(),
            S.documentTypeListItem("product").title("Piezas"),
            S.documentTypeListItem("category").title("Categorías"),
            S.divider(),
            S.listItem()
              .title("Mensajes de contacto")
              .child(
                S.documentTypeList("contactMessage")
                  .title("Mensajes de contacto")
                  .defaultOrdering([
                    { field: "createdAt", direction: "desc" },
                  ]),
              ),
          ]),
    }),
    visionTool({ defaultApiVersion: apiVersion }),
  ],
  document: {
    // Blocks BOTH the global "+"/Cmd-K "create new" menu and the structure
    // pane's own "+" button for the two no-create types — both entry points
    // resolve through this same option (see Sanity's NewDocumentCreationContext).
    newDocumentOptions: (prev) =>
      prev.filter(
        (templateItem) => !NO_CREATE_TYPES.has(templateItem.templateId),
      ),
    actions: (prev, { schemaType }) => {
      if (schemaType === "siteSettings") {
        // Exactly one "Ajustes del sitio" document must ever exist, at the
        // fixed id the structure pane above always opens. Duplicate would
        // create a second, orphaned settings doc; delete would break the
        // artisan's own branding by accident (readers already degrade
        // gracefully to null if the document is ever genuinely absent, but
        // that fallback is meant for "not created yet", not "accidentally
        // deleted").
        return prev.filter(
          ({ action }) => action !== "duplicate" && action !== "delete",
        );
      }
      if (schemaType === "contactMessage") {
        // Read-only inbox: duplicating a message would fabricate an inquiry
        // that was never actually received. Delete stays available so the
        // artisan can clear spam or handled messages.
        return prev.filter(({ action }) => action !== "duplicate");
      }
      return prev;
    },
  },
});
