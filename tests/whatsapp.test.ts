import { describe, expect, it } from "vitest";
import {
  buildWhatsappUrl,
  normalizeWhatsappNumber,
  validateWhatsappNumberInput,
} from "@/lib/site-settings/whatsapp";

const NUMBER = "5215512345678";

// What encodeURIComponent leaves untouched; everything else in the query must
// show up as %XX.
const RAW_SAFE = /^[A-Za-z0-9\-_.!~*'()%]*$/;

describe("normalizeWhatsappNumber", () => {
  it("keeps a clean number as is", () => {
    expect(normalizeWhatsappNumber(NUMBER)).toBe(NUMBER);
  });

  it.each([
    ["a plus sign and spaces", "+52 1 55 1234 5678"],
    ["parentheses and dashes", "(52) 155-1234-5678"],
    ["dots", "52.155.1234.5678"],
    ["surrounding whitespace", "  5215512345678\n"],
  ])("reduces %s to digits", (_label, raw) => {
    expect(normalizeWhatsappNumber(raw)).toBe(NUMBER);
  });

  it("accepts the shortest and the longest usable number (10 and 15 digits)", () => {
    expect(normalizeWhatsappNumber("1234567890")).toBe("1234567890");
    expect(normalizeWhatsappNumber("123456789012345")).toBe("123456789012345");
  });

  it.each<[string, unknown]>([
    ["undefined", undefined],
    ["null", null],
    ["an empty string", ""],
    ["blank text", "   "],
    ["text with no digits", "no tengo"],
    ["only punctuation", "+++ ---"],
    ["nine digits (too short)", "123456789"],
    ["sixteen digits (too long)", "1234567890123456"],
    ["a number instead of a string", 5215512345678],
    ["an object", { number: NUMBER }],
    ["an array", [NUMBER]],
  ])("treats %s as no number", (_label, raw) => {
    expect(normalizeWhatsappNumber(raw)).toBeUndefined();
  });

  it("only ever returns plain digits, whatever it is given", () => {
    const hostile = [
      "5215512345678/../evil",
      "5215512345678?text=hola&x=1",
      "https://evil.example/5215512345678",
      "52155123456<script>7</script>8",
      "５２１５５１２３４５６７８", // full-width digits are not digits here
    ];
    for (const raw of hostile) {
      const result = normalizeWhatsappNumber(raw);
      expect(result === undefined || /^\d{10,15}$/.test(result)).toBe(true);
    }
  });
});

describe("validateWhatsappNumberInput (Studio validation)", () => {
  it.each([undefined, null, ""])(
    "accepts an empty field (%j): the number is optional",
    (value) => {
      expect(validateWhatsappNumberInput(value)).toBe(true);
    },
  );

  it.each([NUMBER, "1234567890", "123456789012345"])(
    "accepts %s: digits only, 10 to 15 long",
    (value) => {
      expect(validateWhatsappNumberInput(value)).toBe(true);
    },
  );

  it.each([
    ["too short", "123456789"],
    ["too long", "1234567890123456"],
    ["a plus sign", "+5215512345678"],
    ["spaces", "52 1 55 1234 5678"],
    ["dashes", "52-1-55-1234-5678"],
    ["letters", "5215512345678a"],
    ["only text", "abc"],
    ["full-width digits", "５２１５５１２３４５６７８"],
    ["surrounding whitespace", " 5215512345678 "],
  ])("rejects a value that is %s, in Spanish", (_label, value) => {
    const result = validateWhatsappNumberInput(value);

    expect(typeof result).toBe("string");
    expect(result).toContain("solo dígitos");
  });

  it("rejects a non-string value", () => {
    expect(typeof validateWhatsappNumberInput(5215512345678)).toBe("string");
  });
});

describe("buildWhatsappUrl", () => {
  it("builds https://wa.me/<digits>?text=<encoded text>", () => {
    expect(buildWhatsappUrl(NUMBER, "Hola, quiero apartar una pieza")).toBe(
      "https://wa.me/5215512345678?text=Hola%2C%20quiero%20apartar%20una%20pieza",
    );
  });

  it("percent-encodes the whole pre-filled text and round-trips it", () => {
    const text = 'Hola & ¿qué tal? #1 "anillo" 50% <b>sí</b>\nsegunda línea 😀';
    const url = buildWhatsappUrl(NUMBER, text);

    expect(url).toBeDefined();
    const query = (url as string).slice((url as string).indexOf("?text=") + 6);
    expect(query).toMatch(RAW_SAFE);
    expect(new URL(url as string).searchParams.get("text")).toBe(text);
  });

  it("uses only the digits of the number", () => {
    expect(buildWhatsappUrl("+52 1 55 1234 5678", "Hola")).toBe(
      "https://wa.me/5215512345678?text=Hola",
    );
  });

  it.each<[string, string | null | undefined]>([
    ["undefined", undefined],
    ["null", null],
    ["an empty string", ""],
    ["a too-short number", "12345"],
    ["text", "no tengo"],
  ])("returns no link for %s", (_label, number) => {
    expect(buildWhatsappUrl(number, "Hola")).toBeUndefined();
  });

  it("cannot be steered away from wa.me by a hostile number", () => {
    const url = buildWhatsappUrl(
      "5215512345678/../../evil?redirect=https://evil.example#",
      "Hola",
    );

    expect(url).toBeDefined();
    const parsed = new URL(url as string);
    expect(parsed.protocol).toBe("https:");
    expect(parsed.hostname).toBe("wa.me");
    expect(parsed.pathname).toMatch(/^\/\d{10,15}$/);
    expect([...parsed.searchParams.keys()]).toEqual(["text"]);
  });

  it("returns the bare chat link when there is no text", () => {
    expect(buildWhatsappUrl(NUMBER, "")).toBe("https://wa.me/5215512345678");
  });
});
