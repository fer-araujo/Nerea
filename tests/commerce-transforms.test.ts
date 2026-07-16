import { describe, expect, it } from "vitest";
import { resolveLocalized, toAvailability, toMoney } from "../lib/commerce/transforms";

// `toAvailability` is a safety-critical, fail-safe derivation: an unknown or
// missing status must resolve to "sold" (never implying a piece is
// buyable when we're unsure) and must never throw, since it runs on raw,
// unverified CMS/fixture data.
describe("toAvailability", () => {
  it("returns 'available' for the exact 'available' status", () => {
    expect(toAvailability("available")).toBe("available");
  });

  it("returns 'sold' for the exact 'sold' status", () => {
    expect(toAvailability("sold")).toBe("sold");
  });

  it.each([undefined, null, "", "unknown", "Available", 0, {}, []])(
    "fails safe to 'sold' for missing/unknown status %j without throwing",
    (status) => {
      expect(() => toAvailability(status)).not.toThrow();
      expect(toAvailability(status)).toBe("sold");
    },
  );
});

describe("toMoney", () => {
  it("always normalizes currency to 'MXN', regardless of the raw source value", () => {
    expect(toMoney({ amount: 185000, currency: "MXN" })).toEqual({
      amount: 185000,
      currency: "MXN",
    });
    expect(toMoney({ amount: 185000, currency: "usd" })).toEqual({
      amount: 185000,
      currency: "MXN",
    });
  });

  it("normalizes currency even when the raw source omits it", () => {
    expect(toMoney({ amount: 95000 })).toEqual({
      amount: 95000,
      currency: "MXN",
    });
  });
});

describe("resolveLocalized", () => {
  it("returns the Spanish field for the 'es' locale", () => {
    expect(resolveLocalized({ es: "Anillo", en: "Ring" }, "es")).toBe(
      "Anillo",
    );
  });

  it("returns the English field for the 'en' locale when present", () => {
    expect(resolveLocalized({ es: "Anillo", en: "Ring" }, "en")).toBe("Ring");
  });

  it("falls back to Spanish for 'en' when the English field is missing", () => {
    expect(resolveLocalized({ es: "Anillo" }, "en")).toBe("Anillo");
  });

  it("falls back to Spanish for 'en' when the English field is an empty string", () => {
    expect(resolveLocalized({ es: "Anillo", en: "" }, "en")).toBe("Anillo");
  });
});
