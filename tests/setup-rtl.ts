// Vitest setup for React Testing Library — extends `expect` with jest-dom
// matchers (`toBeInTheDocument`, etc). Only wired for test files that opt
// into the `jsdom` environment (`// @vitest-environment jsdom`); node-only
// unit tests never load this and stay on the lighter default environment.
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// @testing-library/react's auto-cleanup only self-registers when it finds a
// GLOBAL `afterEach` (e.g. `test.globals: true` in vitest.config.ts). This
// project imports `afterEach` per-file from "vitest" instead, so that
// global never exists and RTL never auto-cleans up — every `render()` call
// within a single test file (across multiple `it()` blocks) would otherwise
// keep accumulating into `document.body`. Registering it explicitly here
// covers every jsdom test file that loads this setup.
afterEach(() => {
  cleanup();
});

// jsdom does not implement `window.matchMedia` — components that read
// `prefers-reduced-motion` (MotionProvider) would otherwise throw a hard
// TypeError on mount. Defaults to `matches: false` (motion allowed); a test
// that specifically needs the reduced-motion branch can reassign
// `window.matchMedia` itself before rendering.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}
