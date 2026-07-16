// Vitest setup for React Testing Library — extends `expect` with jest-dom
// matchers (`toBeInTheDocument`, etc). Only wired for test files that opt
// into the `jsdom` environment (`// @vitest-environment jsdom`); node-only
// unit tests never load this and stay on the lighter default environment.
import "@testing-library/jest-dom/vitest";
