import { defineConfig } from "sanity";
import { structureTool } from "sanity/structure";
import { visionTool } from "@sanity/vision";
import { apiVersion, dataset, projectId } from "./sanity/env";
import { schemaTypes } from "./sanity/schemaTypes";

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
  plugins: [structureTool(), visionTool({ defaultApiVersion: apiVersion })],
});
