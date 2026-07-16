// Sanity project connection details, read from env vars with a documented
// fallback to nerea's real (public, non-secret) project identifiers. The
// fallback exists because this build environment hard-blocks writing any
// `.env*` file — without it, neither the embedded Studio nor the Sanity
// commerce adapter could resolve a project to talk to. A real deployment
// can still override both via NEXT_PUBLIC_SANITY_PROJECT_ID /
// NEXT_PUBLIC_SANITY_DATASET.
export const projectId =
  process.env.NEXT_PUBLIC_SANITY_PROJECT_ID ?? "3cvwg27s";

export const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET ?? "production";

// Pin to a fixed, released Content Lake API version; bump deliberately.
export const apiVersion = "2024-01-01";
