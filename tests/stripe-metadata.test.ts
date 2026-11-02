import { describe, expect, it } from "vitest";
import {
  METADATA_VALUE_MAX,
  parseHandles,
  parseItems,
  quantitiesByHandle,
  readSessionItems,
  serializeItems,
  type SessionItem,
} from "@/lib/commerce/stripe/metadata";

describe("serializeItems", () => {
  it("writes handle*quantity, with |size= or |chain= for a chosen option, joined by ;", () => {
    expect(
      serializeItems([
        { handle: "handle", quantity: 2, option: { kind: "ringSize", value: "7" } },
        { handle: "handle2", quantity: 1, option: { kind: "chainLength", lengthCm: 45 } },
        { handle: "aretes", quantity: 3 },
      ]),
    ).toBe("handle*2|size=7;handle2*1|chain=45;aretes*3");
  });

  it("is empty for no items", () => {
    expect(serializeItems([])).toBe("");
  });

  it("percent-escapes every character the format uses, and the escape itself", () => {
    expect(
      serializeItems([
        { handle: "a;b*c|d=e,f%g", quantity: 1, option: { kind: "ringSize", value: "7;8*9" } },
      ]),
    ).toBe("a%3Bb%2Ac%7Cd%3De%2Cf%25g*1|size=7%3B8%2A9");
  });

  it("leaves a normal slug and a decimal size untouched", () => {
    expect(
      serializeItems([
        { handle: "anillo-plata-cera-perdida", quantity: 1, option: { kind: "ringSize", value: "7.5" } },
      ]),
    ).toBe("anillo-plata-cera-perdida*1|size=7.5");
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 2])(
    "throws for a quantity of %j rather than write something the webhook cannot trust",
    (quantity) => {
      expect(() => serializeItems([{ handle: "a", quantity }])).toThrow();
    },
  );
});

describe("parseItems", () => {
  it("is the inverse of serializeItems", () => {
    const items: SessionItem[] = [
      { handle: "handle", quantity: 2, option: { kind: "ringSize", value: "7" } },
      { handle: "handle2", quantity: 1, option: { kind: "chainLength", lengthCm: 45 } },
      { handle: "aretes", quantity: 12 },
    ];

    expect(parseItems(serializeItems(items))).toEqual(items);
  });

  it("round-trips handles and sizes made of the format's own characters, exactly", () => {
    const nasty: SessionItem[] = [
      { handle: "a;b*c|d=e,f%g", quantity: 3, option: { kind: "ringSize", value: "7;8*9|=%" } },
      { handle: "%41%3B", quantity: 1 },
      { handle: ";;;", quantity: 2, option: { kind: "ringSize", value: "," } },
      { handle: "ñandú — café", quantity: 4 },
    ];

    expect(parseItems(serializeItems(nasty))).toEqual(nasty);
  });

  it("round-trips a chain length with decimals", () => {
    const items: SessionItem[] = [
      { handle: "dije", quantity: 1, option: { kind: "chainLength", lengthCm: 42.5 } },
    ];

    expect(parseItems(serializeItems(items))).toEqual(items);
  });

  it("round-trips a long cart that still fits Stripe's metadata cap", () => {
    const items: SessionItem[] = Array.from({ length: 12 }, (_, index) => ({
      handle: `pieza-${index}`,
      quantity: index + 1,
      option: { kind: "ringSize", value: "7" },
    }));
    const serialized = serializeItems(items);
    expect(serialized.length).toBeLessThanOrEqual(METADATA_VALUE_MAX);

    expect(parseItems(serialized)).toEqual(items);
  });

  it.each([undefined, null, ""])("reads %j as no items", (raw) => {
    expect(parseItems(raw)).toEqual([]);
  });

  it("skips entries that do not parse and keeps the rest, never throwing", () => {
    expect(
      parseItems(
        [
          "bueno*2|size=7",
          "",
          "   ",
          "sin-cantidad",
          "*3",
          "cero*0",
          "negativo*-1",
          "decimal*1.5",
          "texto*dos",
          "doble*1*2",
          "exponente*1e2",
          "otro*4",
        ].join(";"),
      ),
    ).toEqual([
      { handle: "bueno", quantity: 2, option: { kind: "ringSize", value: "7" } },
      { handle: "otro", quantity: 4 },
    ]);
  });

  it("keeps the PIECE, without its option, when only the option is unreadable", () => {
    expect(
      parseItems(
        [
          "a*2|weird=1",
          "b*1|size=",
          "c*1|chain=abc",
          "d*1|chain=0",
          "e*1|chain=-5",
          "f*1|size",
          "g*1|",
        ].join(";"),
      ),
    ).toEqual([
      { handle: "a", quantity: 2 },
      { handle: "b", quantity: 1 },
      { handle: "c", quantity: 1 },
      { handle: "d", quantity: 1 },
      { handle: "e", quantity: 1 },
      { handle: "f", quantity: 1 },
      { handle: "g", quantity: 1 },
    ]);
  });

  it("ignores whitespace around an entry", () => {
    expect(parseItems(" a*1 ; b*2 ")).toEqual([
      { handle: "a", quantity: 1 },
      { handle: "b", quantity: 2 },
    ]);
  });
});

describe("readSessionItems", () => {
  it("prefers metadata.items over metadata.handles", () => {
    expect(
      readSessionItems({
        handles: "anillo,aretes",
        items: "anillo*3|size=7;aretes*1",
      }),
    ).toEqual([
      { handle: "anillo", quantity: 3, option: { kind: "ringSize", value: "7" } },
      { handle: "aretes", quantity: 1 },
    ]);
  });

  it("falls back to metadata.handles with quantity 1 for a session that predates quantities", () => {
    expect(readSessionItems({ handles: "anillo,aretes" })).toEqual([
      { handle: "anillo", quantity: 1 },
      { handle: "aretes", quantity: 1 },
    ]);
  });

  it("takes a legacy session's chosen options from metadata.options", () => {
    expect(
      readSessionItems({
        handles: "anillo,dije",
        options: "anillo:size=7,dije:chain=45",
      }),
    ).toEqual([
      { handle: "anillo", quantity: 1, option: { kind: "ringSize", value: "7" } },
      { handle: "dije", quantity: 1, option: { kind: "chainLength", lengthCm: 45 } },
    ]);
  });

  // `handles` is a COMMA list; a slug typed by hand in Studio could hold a
  // comma and split into pieces that were never sold. `items` escapes it.
  it("never consults handles when items is present, even for a handle items does not name", () => {
    expect(
      readSessionItems({ handles: "anillo,aretes", items: "anillo*2" }),
    ).toEqual([{ handle: "anillo", quantity: 2 }]);
  });

  it("does not use handles when items is present but unreadable: no phantom pieces", () => {
    expect(readSessionItems({ handles: "anillo", items: "basura;;*" })).toEqual([]);
  });

  it("reads a slug with a comma whole from items, where the legacy list would split it", () => {
    expect(
      readSessionItems({ handles: "rara,pieza", items: serializeItems([{ handle: "rara,pieza", quantity: 2 }]) }),
    ).toEqual([{ handle: "rara,pieza", quantity: 2 }]);
  });

  it("does consult handles when there is no items at all, or a blank one (a session that predates quantities)", () => {
    expect(readSessionItems({ handles: "anillo" })).toEqual([{ handle: "anillo", quantity: 1 }]);
    expect(readSessionItems({ handles: "anillo", items: "" })).toEqual([
      { handle: "anillo", quantity: 1 },
    ]);
    expect(readSessionItems({ handles: "anillo", items: "   " })).toEqual([
      { handle: "anillo", quantity: 1 },
    ]);
  });

  it("lists a legacy handle once, however often it repeats", () => {
    expect(readSessionItems({ handles: "anillo,anillo, anillo" })).toEqual([
      { handle: "anillo", quantity: 1 },
    ]);
  });

  it("keeps the several lines of one design that items names", () => {
    expect(
      readSessionItems({ items: "anillo*2|size=6;anillo*1|size=7" }),
    ).toHaveLength(2);
  });

  it.each([undefined, null, {}])("reads %j as no items", (metadata) => {
    expect(readSessionItems(metadata as Record<string, string> | null | undefined)).toEqual([]);
  });
});

describe("quantitiesByHandle", () => {
  it("adds the lines of one design up, keeping first-seen order", () => {
    expect([
      ...quantitiesByHandle([
        { handle: "anillo", quantity: 2, option: { kind: "ringSize", value: "6" } },
        { handle: "aretes", quantity: 1 },
        { handle: "anillo", quantity: 3, option: { kind: "ringSize", value: "7" } },
      ]),
    ]).toEqual([
      ["anillo", 5],
      ["aretes", 1],
    ]);
  });
});

describe("parseHandles", () => {
  it("splits the comma list, trimming blanks", () => {
    expect(parseHandles(" a , b,,c ")).toEqual(["a", "b", "c"]);
  });

  it.each([undefined, null, ""])("reads %j as no handles", (raw) => {
    expect(parseHandles(raw)).toEqual([]);
  });
});
