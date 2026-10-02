import { describe, expect, it, vi } from "vitest";

// The catalog is out of scope here: an empty one keeps the test credential-free
// and leaves only the static entries to look at.
vi.mock("@/lib/commerce", () => ({
  commerce: { getProducts: vi.fn().mockResolvedValue([]) },
}));

import sitemap from "../app/sitemap";

describe("sitemap", () => {
  it("lists the legal pages in every locale, with hreflang alternates", async () => {
    const entries = await sitemap();

    for (const locale of ["es", "en"]) {
      for (const path of ["privacidad", "terminos", "envios"]) {
        const entry = entries.find((candidate) =>
          candidate.url.endsWith(`/${locale}/${path}`),
        );

        expect(entry, `${locale}/${path}`).toBeDefined();
        expect(Object.keys(entry?.alternates?.languages ?? {})).toEqual(
          expect.arrayContaining(["es", "en", "x-default"]),
        );
      }
    }
  });

  it("ranks the legal pages below the storefront pages", async () => {
    const entries = await sitemap();
    const priorityOf = (suffix: string) =>
      entries.find((entry) => entry.url.endsWith(suffix))?.priority;

    expect(priorityOf("/es/privacidad")).toBeLessThan(priorityOf("/es/shop") ?? 0);
  });

  it("keeps the existing static routes", async () => {
    const urls = (await sitemap()).map((entry) => entry.url);

    for (const path of ["/es", "/en", "/es/shop", "/es/about", "/en/contact"]) {
      expect(urls.some((url) => url.endsWith(path))).toBe(true);
    }
  });
});
