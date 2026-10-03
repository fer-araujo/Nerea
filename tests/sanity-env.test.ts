import { afterEach, describe, expect, it, vi } from "vitest";

// An empty variable is a SET variable: `NEXT_PUBLIC_SANITY_PROJECT_ID=` in
// .env.local reads as "", which `??` would keep — and Sanity's client throws on
// an empty projectId. Empty or whitespace-only must mean "unset", so the
// documented fallback applies.
const PROJECT_ID_KEY = "NEXT_PUBLIC_SANITY_PROJECT_ID";
const DATASET_KEY = "NEXT_PUBLIC_SANITY_DATASET";

const FALLBACK_PROJECT_ID = "3cvwg27s";
const FALLBACK_DATASET = "production";

const originalProjectId = process.env[PROJECT_ID_KEY];
const originalDataset = process.env[DATASET_KEY];

function setEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

// `sanity/env` reads process.env once, at module load, so each case re-imports it.
async function loadEnv(projectId: string | undefined, dataset: string | undefined) {
  setEnv(PROJECT_ID_KEY, projectId);
  setEnv(DATASET_KEY, dataset);
  vi.resetModules();
  return import("@/sanity/env");
}

afterEach(() => {
  setEnv(PROJECT_ID_KEY, originalProjectId);
  setEnv(DATASET_KEY, originalDataset);
  vi.resetModules();
});

describe("sanity/env fallbacks", () => {
  it("falls back to nerea's project and dataset when both are unset", async () => {
    const env = await loadEnv(undefined, undefined);

    expect(env.projectId).toBe(FALLBACK_PROJECT_ID);
    expect(env.dataset).toBe(FALLBACK_DATASET);
  });

  it.each([["empty", ""], ["whitespace only", "   "]])(
    "falls back when both are set but %s",
    async (_label, blank) => {
      const env = await loadEnv(blank, blank);

      expect(env.projectId).toBe(FALLBACK_PROJECT_ID);
      expect(env.dataset).toBe(FALLBACK_DATASET);
    },
  );

  it("uses explicit values, trimmed", async () => {
    const env = await loadEnv("  abc123  ", "staging\n");

    expect(env.projectId).toBe("abc123");
    expect(env.dataset).toBe("staging");
  });

  it("falls back for each variable independently", async () => {
    const onlyProject = await loadEnv("abc123", "");
    expect(onlyProject.projectId).toBe("abc123");
    expect(onlyProject.dataset).toBe(FALLBACK_DATASET);

    const onlyDataset = await loadEnv("", "staging");
    expect(onlyDataset.projectId).toBe(FALLBACK_PROJECT_ID);
    expect(onlyDataset.dataset).toBe("staging");
  });

  it("keeps the pinned API version", async () => {
    const env = await loadEnv(undefined, undefined);

    expect(env.apiVersion).toBe("2024-01-01");
  });
});
