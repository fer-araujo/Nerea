import { afterEach, describe, expect, it, vi } from "vitest";
import { selectCommerceApi } from "@/lib/commerce";
import { fixturesApi } from "@/lib/commerce/fixtures";
import { sanityApi } from "@/lib/commerce/sanity/adapter";

// Root cause of "the store showed fixture products": `COMMERCE_SOURCE=` (a
// blank line copied from env.example into .env.local) is a SET variable whose
// value is "", so the old `process.env.COMMERCE_SOURCE ?? "sanity"` kept the
// empty string and fell through to the fixtures. Fixtures are now an explicit
// opt-in: only the exact (trimmed) value "fixtures".
describe("selectCommerceApi", () => {
  it.each([["fixtures"], ["  fixtures  "], ["\tfixtures\n"]])(
    "selects the fixtures for the exact value %j (after trimming)",
    (value) => {
      expect(selectCommerceApi(value)).toBe(fixturesApi);
    },
  );

  it.each<[string, string | undefined]>([
    ["unset", undefined],
    ["empty", ""],
    ["whitespace only", "   "],
    ["sanity", "sanity"],
    ["fixtures in another case", "Fixtures"],
    ["fixtures in upper case", "FIXTURES"],
    ["a typo of fixtures", "fixture"],
    ["fixtures with a suffix", "fixtures-old"],
    ["an unrelated backend", "shopify"],
  ])("selects the live Sanity catalog when the value is %s", (_label, value) => {
    expect(selectCommerceApi(value)).toBe(sanityApi);
  });
});

describe("commerce — chosen at import time from process.env", () => {
  const original = process.env.COMMERCE_SOURCE;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.COMMERCE_SOURCE;
    } else {
      process.env.COMMERCE_SOURCE = original;
    }
    vi.resetModules();
  });

  // The seam is a module-level constant, so each case re-imports it. The
  // adapters are imported AFTER the reset too, so the identity check compares
  // against the very instances the freshly loaded seam picked from.
  async function loadSeam(value: string | undefined) {
    if (value === undefined) {
      delete process.env.COMMERCE_SOURCE;
    } else {
      process.env.COMMERCE_SOURCE = value;
    }
    vi.resetModules();

    const [seam, sanity, fixtures] = await Promise.all([
      import("@/lib/commerce"),
      import("@/lib/commerce/sanity/adapter"),
      import("@/lib/commerce/fixtures"),
    ]);
    return {
      commerce: seam.commerce,
      sanityApi: sanity.sanityApi,
      fixturesApi: fixtures.fixturesApi,
    };
  }

  it("serves the live Sanity catalog when COMMERCE_SOURCE is unset", async () => {
    const loaded = await loadSeam(undefined);
    expect(loaded.commerce).toBe(loaded.sanityApi);
  });

  it("serves the live Sanity catalog when COMMERCE_SOURCE is set but empty", async () => {
    const loaded = await loadSeam("");
    expect(loaded.commerce).toBe(loaded.sanityApi);
  });

  it("serves the fixtures only when COMMERCE_SOURCE is exactly 'fixtures'", async () => {
    const loaded = await loadSeam("fixtures");
    expect(loaded.commerce).toBe(loaded.fixturesApi);
  });
});
