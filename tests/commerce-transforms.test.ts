import { describe, expect, it } from "vitest";
import {
  resolveLocalized,
  toAvailability,
  toMoney,
  toStock,
} from "../lib/commerce/transforms";

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

// `stock` is the piece count (sanity/schemaTypes/product.ts). When the document
// has one it decides; when it has none (every document that predates the field)
// the legacy status decides, with the same fail-safe as above.
describe("toStock", () => {
  it("reads a defined stock as it is", () => {
    expect(toStock(1, "sold")).toBe(1);
    expect(toStock(7, "available")).toBe(7);
    expect(toStock(0, "available")).toBe(0);
  });

  it("floors a fractional count and never goes below zero", () => {
    expect(toStock(2.9, undefined)).toBe(2);
    expect(toStock(-4, "available")).toBe(0);
  });

  it.each([undefined, null])(
    "falls back to the legacy status when the stock is %j: available is one piece, anything else none",
    (stock) => {
      expect(toStock(stock, "available")).toBe(1);
      expect(toStock(stock, "sold")).toBe(0);
      expect(toStock(stock, undefined)).toBe(0);
      expect(toStock(stock, "Available")).toBe(0);
    },
  );

  it.each([Number.NaN, Number.POSITIVE_INFINITY, "3", {}, []])(
    "does not read %j as a count: the legacy status decides instead, without throwing",
    (stock) => {
      expect(() => toStock(stock, "available")).not.toThrow();
      expect(toStock(stock, "available")).toBe(1);
      expect(toStock(stock, "sold")).toBe(0);
    },
  );
});

describe("toAvailability with a stock", () => {
  it("is available while the stock is above zero, even when the legacy status says sold", () => {
    expect(toAvailability("sold", 3)).toBe("available");
    expect(toAvailability("available", 1)).toBe("available");
  });

  it("is sold at zero, even when the legacy status says available", () => {
    expect(toAvailability("available", 0)).toBe("sold");
  });

  it("falls back to the legacy status when there is no stock", () => {
    expect(toAvailability("available", undefined)).toBe("available");
    expect(toAvailability("available", null)).toBe("available");
    expect(toAvailability("sold", null)).toBe("sold");
    expect(toAvailability(undefined, null)).toBe("sold");
  });
});
