import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts", "**/*.test.tsx"],
    setupFiles: ["./tests/setup-rtl.ts"],
    server: {
      deps: {
        inline: ["next-intl", "next"],
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      // next-intl's middleware imports the extension-less "next/server"
      // specifier; Vite's resolver needs the explicit file since the
      // installed `next` package has no "exports" map for that subpath.
      "next/server": path.resolve(__dirname, "node_modules/next/server.js"),
    },
  },
});
