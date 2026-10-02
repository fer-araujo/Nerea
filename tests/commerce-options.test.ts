import { describe, expect, it } from "vitest";
import enMessages from "../messages/en.json";
import esMessages from "../messages/es.json";
import {
  DEFAULT_CHAIN_LENGTHS,
  DEFAULT_RING_SIZES,
  formatOptionLabel,
  resolveProductOptions,
  serializeOption,
  validateOption,
} from "../lib/commerce/options";
import type {
  Locale,
  ProductOptions,
  SelectedOption,
} from "../lib/commerce/types";

interface CartOptionMessages {
  optionRingSize: string;
  optionChainLength: string;
}

const RING: ProductOptions = { kind: "ringSize", values: ["6", "7", "7.5"] };
const CHAIN: ProductOptions = {
  kind: "chainLength",
  values: [
    { lengthCm: 40, extra: 0 },
    { lengthCm: 45, extra: 0 },
    { lengthCm: 50, extra: 15000 },
  ],
};
const NONE: ProductOptions = { kind: "none" };

describe("code defaults", () => {
  it("offers ring sizes 4 to 13 in half steps", () => {
    expect(DEFAULT_RING_SIZES).toHaveLength(19);
    expect(DEFAULT_RING_SIZES[0]).toBe("4");
    expect(DEFAULT_RING_SIZES[1]).toBe("4.5");
    expect(DEFAULT_RING_SIZES.at(-1)).toBe("13");
  });

  it("offers chain lengths 40/45/50 cm with no extra", () => {
    expect(DEFAULT_CHAIN_LENGTHS).toEqual([
      { lengthCm: 40, extra: 0 },
      { lengthCm: 45, extra: 0 },
      { lengthCm: 50, extra: 0 },
    ]);
  });
});

describe("resolveProductOptions — resolution order", () => {
  it.each([undefined, null, "none", "", "ring-size", 42 as unknown as string])(
    "resolves an unset or unrecognized purchaseOption (%j) to none",
    (purchaseOption) => {
      expect(resolveProductOptions({ purchaseOption })).toEqual({ kind: "none" });
    },
  );

  it("prefers the piece's own ring sizes over the site defaults", () => {
    expect(
      resolveProductOptions(
        { purchaseOption: "ringSize", ringSizes: ["6", "7"] },
        { ringSizes: ["8", "9"] },
      ),
    ).toEqual({ kind: "ringSize", values: ["6", "7"] });
  });

  it("falls back to the site defaults when the piece's list is empty or null", () => {
    for (const ringSizes of [[], null, undefined]) {
      expect(
        resolveProductOptions(
          { purchaseOption: "ringSize", ringSizes },
          { ringSizes: ["8", "9"] },
        ),
      ).toEqual({ kind: "ringSize", values: ["8", "9"] });
    }
  });

  it("falls back to the code defaults when neither the piece nor the site has a list", () => {
    expect(
      resolveProductOptions({ purchaseOption: "ringSize", ringSizes: [] }, null),
    ).toEqual({ kind: "ringSize", values: [...DEFAULT_RING_SIZES] });
    expect(
      resolveProductOptions(
        { purchaseOption: "chainLength", chainLengths: null },
        { chainLengths: [] },
      ),
    ).toEqual({ kind: "chainLength", values: [...DEFAULT_CHAIN_LENGTHS] });
  });

  it("resolves chain lengths piece -> site -> code, mapping extraPrice to extra", () => {
    const resolved = resolveProductOptions(
      {
        purchaseOption: "chainLength",
        chainLengths: [{ lengthCm: 60, extraPrice: 30000 }],
      },
      { chainLengths: [{ lengthCm: 45, extraPrice: 0 }] },
    );
    expect(resolved).toEqual({
      kind: "chainLength",
      values: [{ lengthCm: 60, extra: 30000 }],
    });

    expect(
      resolveProductOptions(
        { purchaseOption: "chainLength", chainLengths: [] },
        { chainLengths: [{ lengthCm: 45, extraPrice: 5000 }] },
      ),
    ).toEqual({
      kind: "chainLength",
      values: [{ lengthCm: 45, extra: 5000 }],
    });
  });

  it("only reads the override that matches the chosen kind", () => {
    // Switching a piece from rings to chains in Studio leaves the old
    // ringSizes behind (hidden, not deleted) — it must not leak into chains.
    expect(
      resolveProductOptions({
        purchaseOption: "chainLength",
        ringSizes: ["6"],
      }),
    ).toEqual({ kind: "chainLength", values: [...DEFAULT_CHAIN_LENGTHS] });
  });
});

describe("resolveProductOptions — normalization of CMS data", () => {
  it("trims, drops blanks and non-strings, de-duplicates and sorts ring sizes numerically", () => {
    expect(
      resolveProductOptions({
        purchaseOption: "ringSize",
        ringSizes: ["8", " 6 ", "", "7.5", "6", null, "10"],
      }),
    ).toEqual({ kind: "ringSize", values: ["6", "7.5", "8", "10"] });
  });

  it("keeps the artisan's order for chain lengths and drops duplicates", () => {
    expect(
      resolveProductOptions({
        purchaseOption: "chainLength",
        chainLengths: [
          { lengthCm: 50, extraPrice: 0 },
          { lengthCm: 40, extraPrice: 0 },
          { lengthCm: 50, extraPrice: 9900 },
        ],
      }),
    ).toEqual({
      kind: "chainLength",
      values: [
        { lengthCm: 50, extra: 0 },
        { lengthCm: 40, extra: 0 },
      ],
    });
  });

  it("treats a missing surcharge as 0 but drops entries with a present-but-invalid one", () => {
    expect(
      resolveProductOptions({
        purchaseOption: "chainLength",
        chainLengths: [
          { lengthCm: 40 },
          { lengthCm: 45, extraPrice: null },
          { lengthCm: 50, extraPrice: -500 },
          { lengthCm: 55, extraPrice: 150.5 },
          { lengthCm: 60, extraPrice: "100" as unknown as number },
        ],
      }),
    ).toEqual({
      kind: "chainLength",
      values: [
        { lengthCm: 40, extra: 0 },
        { lengthCm: 45, extra: 0 },
      ],
    });
  });

  it("drops entries with an unusable length", () => {
    expect(
      resolveProductOptions({
        purchaseOption: "chainLength",
        chainLengths: [
          null,
          { lengthCm: null },
          { lengthCm: 0 },
          { lengthCm: -10 },
          { lengthCm: Number.NaN },
          { lengthCm: 45, extraPrice: 0 },
        ],
      }),
    ).toEqual({ kind: "chainLength", values: [{ lengthCm: 45, extra: 0 }] });
  });
});

describe("validateOption", () => {
  describe("a piece with no option", () => {
    it.each([undefined, null])("accepts %j", (selected) => {
      expect(validateOption(NONE, selected)).toEqual({
        valid: true,
        extra: 0,
        option: null,
      });
    });

    it("rejects any option as unexpected", () => {
      expect(
        validateOption(NONE, { kind: "ringSize", value: "7" }),
      ).toEqual({ valid: false, reason: "unexpected" });
      expect(validateOption(NONE, {})).toEqual({
        valid: false,
        reason: "unexpected",
      });
    });
  });

  describe("ring size", () => {
    it.each([undefined, null])("reports %j as missing", (selected) => {
      expect(validateOption(RING, selected)).toEqual({
        valid: false,
        reason: "missing",
      });
    });

    it("accepts a size the catalog offers, with no extra", () => {
      expect(validateOption(RING, { kind: "ringSize", value: "7.5" })).toEqual({
        valid: true,
        extra: 0,
        option: { kind: "ringSize", value: "7.5" },
      });
    });

    it.each<[string, unknown]>([
      ["a size the catalog does not offer", { kind: "ringSize", value: "99" }],
      ["a differently formatted size", { kind: "ringSize", value: "7.0" }],
      ["a non-string value", { kind: "ringSize", value: 7 }],
      ["a missing value", { kind: "ringSize" }],
      ["a chain option sent for a ring", { kind: "chainLength", lengthCm: 45 }],
      ["an unknown kind", { kind: "weird", value: "7" }],
      ["a bare string", "7"],
      ["a number", 7],
      ["an array", ["7"]],
    ])("reports %s as unknown", (_label, selected) => {
      expect(validateOption(RING, selected)).toEqual({
        valid: false,
        reason: "unknown",
      });
    });

    it("returns a clean copy, dropping anything extra the client attached", () => {
      const tampered = {
        kind: "ringSize",
        value: "7",
        extra: -100000,
        price: 1,
      };
      const result = validateOption(RING, tampered);
      expect(result).toEqual({
        valid: true,
        extra: 0,
        option: { kind: "ringSize", value: "7" },
      });
      expect(result.valid && result.option).not.toBe(tampered);
    });
  });

  describe("chain length", () => {
    it("reports a missing choice", () => {
      expect(validateOption(CHAIN, undefined)).toEqual({
        valid: false,
        reason: "missing",
      });
    });

    it("accepts an offered length and returns the CATALOG's extra", () => {
      expect(
        validateOption(CHAIN, { kind: "chainLength", lengthCm: 50 }),
      ).toEqual({
        valid: true,
        extra: 15000,
        option: { kind: "chainLength", lengthCm: 50 },
      });
      expect(
        validateOption(CHAIN, { kind: "chainLength", lengthCm: 40 }),
      ).toMatchObject({ valid: true, extra: 0 });
    });

    it("ignores an extra the client claims for itself", () => {
      expect(
        validateOption(CHAIN, {
          kind: "chainLength",
          lengthCm: 50,
          extra: 0,
          extraPrice: 0,
        }),
      ).toMatchObject({ valid: true, extra: 15000 });
    });

    it.each<[string, unknown]>([
      ["a length the catalog does not offer", { kind: "chainLength", lengthCm: 99 }],
      ["a stringified length", { kind: "chainLength", lengthCm: "45" }],
      ["a NaN length", { kind: "chainLength", lengthCm: Number.NaN }],
      ["a missing length", { kind: "chainLength" }],
      ["a ring option sent for a chain", { kind: "ringSize", value: "7" }],
    ])("reports %s as unknown", (_label, selected) => {
      expect(validateOption(CHAIN, selected)).toEqual({
        valid: false,
        reason: "unknown",
      });
    });

    it.each([
      ["negative", -5000],
      ["fractional", 150.5],
      ["NaN", Number.NaN],
    ])("fails closed when the catalog's own extra is %s", (_label, extra) => {
      // Defence in depth: resolveProductOptions already drops these, but a
      // hand-built ProductOptions must not be able to discount a piece.
      const malformed: ProductOptions = {
        kind: "chainLength",
        values: [{ lengthCm: 45, extra }],
      };
      expect(
        validateOption(malformed, { kind: "chainLength", lengthCm: 45 }),
      ).toEqual({ valid: false, reason: "unknown" });
    });
  });
});

describe("formatOptionLabel", () => {
  const ring: SelectedOption = { kind: "ringSize", value: "7" };
  const chain: SelectedOption = { kind: "chainLength", lengthCm: 45 };

  it("formats Spanish labels", () => {
    expect(formatOptionLabel(ring, "es")).toBe("Talla 7");
    expect(formatOptionLabel(chain, "es")).toBe("Cadena 45 cm");
  });

  it("formats English labels", () => {
    expect(formatOptionLabel(ring, "en")).toBe("Size 7");
    expect(formatOptionLabel(chain, "en")).toBe("45 cm chain");
  });

  it("keeps half sizes as-is", () => {
    expect(formatOptionLabel({ kind: "ringSize", value: "7.5" }, "es")).toBe(
      "Talla 7.5",
    );
  });

  // The Stripe line name (formatOptionLabel, server) and the cart drawer
  // (messages/*.json via next-intl) must say the same thing. They are two
  // sources by necessity — next-intl's client messages are not at hand in the
  // server action — so this pins them together.
  const DRAWER_MESSAGES: [Locale, CartOptionMessages][] = [
    ["es", esMessages.Cart],
    ["en", enMessages.Cart],
  ];
  it.each(DRAWER_MESSAGES)(
    "matches the %s cart drawer messages",
    (locale, messages) => {
      expect(messages.optionRingSize.replace("{value}", "7.5")).toBe(
        formatOptionLabel({ kind: "ringSize", value: "7.5" }, locale),
      );
      expect(messages.optionChainLength.replace("{cm}", "45")).toBe(
        formatOptionLabel({ kind: "chainLength", lengthCm: 45 }, locale),
      );
    },
  );
});

describe("serializeOption", () => {
  it("writes compact handle:size / handle:chain pairs", () => {
    expect(
      serializeOption("anillo", { kind: "ringSize", value: "7.5" }),
    ).toBe("anillo:size=7.5");
    expect(
      serializeOption("dije", { kind: "chainLength", lengthCm: 45 }),
    ).toBe("dije:chain=45");
  });
});
