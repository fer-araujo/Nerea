import { describe, expect, it } from "vitest";
import {
  MAX_REPLY_MAILTO_LENGTH,
  REPLY_SUBJECT,
  buildReplyMailto,
  mailtoHref,
} from "@/lib/admin/reply-mailto";

const EMAIL = "ana@example.com";
const RECEIVED_AT = "1 oct 2026, 9:30 p.m.";

// What encodeURIComponent leaves untouched. Everything else that appears in a
// URL built from visitor input must show up as %XX, never raw.
const RAW_SAFE = /^[A-Za-z0-9\-_.!~*'()%]*$/;

function bodyOf(url: string): string {
  return new URL(url).searchParams.get("body") ?? "";
}

function rawBodyOf(url: string): string {
  return url.slice(url.indexOf("body=") + "body=".length);
}

function countOf(text: string, character: string): number {
  return text.split(character).length - 1;
}

describe("mailtoHref", () => {
  it("keeps the @ literal", () => {
    expect(mailtoHref(EMAIL)).toBe("mailto:ana@example.com");
  });

  it("percent-encodes everything else", () => {
    expect(mailtoHref("a+b@example.com")).toBe("mailto:a%2Bb@example.com");
  });
});

describe("buildReplyMailto — content", () => {
  it("addresses the stored email, with the reply subject", () => {
    const url = buildReplyMailto({
      email: EMAIL,
      message: "Hola",
      receivedAt: RECEIVED_AT,
    });

    expect(url.startsWith("mailto:ana@example.com?subject=")).toBe(true);
    expect(new URL(url).searchParams.get("subject")).toBe(
      "Re: tu mensaje a nerea",
    );
    expect(REPLY_SUBJECT).toBe("Re: tu mensaje a nerea");
  });

  it("leaves room to type, then quotes the message as '> ' lines under the heading", () => {
    const url = buildReplyMailto({
      email: EMAIL,
      message: "Hola, me interesa el anillo.\n\n¿Tienen talla 7?",
      receivedAt: RECEIVED_AT,
    });

    expect(bodyOf(url)).toBe(
      "\r\n\r\n— Escribiste el 1 oct 2026, 9:30 p.m.:\r\n" +
        "> Hola, me interesa el anillo.\r\n" +
        ">\r\n" +
        "> ¿Tienen talla 7?",
    );
  });

  it("uses CRLF line breaks whatever the stored message used", () => {
    const url = buildReplyMailto({
      email: EMAIL,
      message: "uno\r\ndos\rtres\ncuatro",
      receivedAt: RECEIVED_AT,
    });

    expect(bodyOf(url).split("\r\n").slice(-4)).toEqual([
      "> uno",
      "> dos",
      "> tres",
      "> cuatro",
    ]);
    // Every line break is a CRLF pair: no bare LF or CR is left over.
    expect(rawBodyOf(url).split("%0D%0A").join("")).not.toMatch(/%0[AD]/);
  });

  it("trims the stored message", () => {
    const url = buildReplyMailto({
      email: EMAIL,
      message: "  \n Hola \n\n ",
      receivedAt: RECEIVED_AT,
    });

    expect(bodyOf(url).endsWith(":\r\n> Hola")).toBe(true);
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["blank", "   "],
  ])("drops the date from the heading when it is %s", (_label, receivedAt) => {
    const url = buildReplyMailto({ email: EMAIL, message: "Hola", receivedAt });

    expect(bodyOf(url)).toBe("\r\n\r\n— Escribiste:\r\n> Hola");
  });

  it("turns no-break spaces in the date into plain spaces", () => {
    const url = buildReplyMailto({
      email: EMAIL,
      message: "Hola",
      receivedAt: "1 oct 2026, 9:30\u202fp.m.",
    });

    expect(bodyOf(url)).toContain("el 1 oct 2026, 9:30 p.m.:");
  });

  it("writes just the heading for an empty message", () => {
    const url = buildReplyMailto({
      email: EMAIL,
      message: "   ",
      receivedAt: RECEIVED_AT,
    });

    expect(bodyOf(url)).toBe("\r\n\r\n— Escribiste el 1 oct 2026, 9:30 p.m.:\r\n");
  });
});

describe("buildReplyMailto — encoding", () => {
  const HOSTILE_MESSAGE =
    'a&b=c?d#e%f+g "h" <i> ;j, k/l \\m\nsegunda línea\n😀 ñ á';

  it("percent-encodes every visitor-supplied character in the body", () => {
    const url = buildReplyMailto({
      email: EMAIL,
      message: HOSTILE_MESSAGE,
      receivedAt: RECEIVED_AT,
    });

    expect(rawBodyOf(url)).toMatch(RAW_SAFE);
    // ...and it round-trips back to exactly what was typed.
    expect(bodyOf(url)).toContain(
      '> a&b=c?d#e%f+g "h" <i> ;j, k/l \\m\r\n> segunda línea\r\n> 😀 ñ á',
    );
  });

  it("has exactly one ? and one &, whatever the message says", () => {
    const url = buildReplyMailto({
      email: EMAIL,
      message: HOSTILE_MESSAGE,
      receivedAt: RECEIVED_AT,
    });

    expect(countOf(url, "?")).toBe(1);
    expect(countOf(url, "&")).toBe(1);
    expect([...new URL(url).searchParams.keys()]).toEqual(["subject", "body"]);
  });

  it("cannot be steered by a message that looks like mailto headers", () => {
    const url = buildReplyMailto({
      email: EMAIL,
      message: "hola&bcc=evil@example.com&subject=hijack?cc=evil@example.com",
      receivedAt: RECEIVED_AT,
    });

    const { searchParams } = new URL(url);
    expect(searchParams.get("bcc")).toBeNull();
    expect(searchParams.get("cc")).toBeNull();
    expect(searchParams.getAll("subject")).toEqual([REPLY_SUBJECT]);
  });
});

describe("buildReplyMailto — no injection through the stored email", () => {
  // The validator only checks "one @, a dot after it, no whitespace", so a
  // stored address can carry mailto syntax. A couple of these (raw line breaks,
  // two @) could only come from a hand-edited document, which the admin page
  // must still treat as untrusted.
  it.each([
    ["a header smuggled after a ?", "a@b.co?bcc=evil.zz"],
    ["a header smuggled after an &", "a@b.co&cc=evil.zz"],
    ["a subject override", "a@b.co?subject=hijack.zz"],
    ["a second recipient after a comma", "a,evil@b.co"],
    ["a fragment", "a@b.co#x.zz"],
    ["percent sequences that spell a header", "a@b.co%0D%0ABcc:evil.zz"],
    ["raw line breaks", "a@b.co\r\nBcc: evil@x.zz"],
    ["angle brackets", "<evil@x.zz>a@b.co"],
    ["two @ signs", "a@b.co?bcc=evil@x.zz"],
  ])("keeps %s inside the recipient", (_label, email) => {
    const url = buildReplyMailto({
      email,
      message: "Hola",
      receivedAt: RECEIVED_AT,
    });
    const parsed = new URL(url);
    const rawRecipient = url.slice("mailto:".length, url.indexOf("?"));

    // The only ? and & are the ones this module wrote itself.
    expect(countOf(url, "?")).toBe(1);
    expect(countOf(url, "&")).toBe(1);
    expect([...parsed.searchParams.keys()]).toEqual(["subject", "body"]);
    expect(parsed.searchParams.getAll("subject")).toEqual([REPLY_SUBJECT]);
    expect(parsed.searchParams.get("bcc")).toBeNull();
    expect(parsed.searchParams.get("cc")).toBeNull();

    // The recipient carries only literal-safe characters (and the one @ kept
    // readable), and decodes back to exactly the stored value.
    expect(rawRecipient).toMatch(/^[A-Za-z0-9\-_.!~*'()%@]*$/);
    expect(decodeURIComponent(rawRecipient)).toBe(email);
  });
});

describe("buildReplyMailto — truncation", () => {
  function reply(message: string, email = EMAIL): string {
    return buildReplyMailto({ email, message, receivedAt: RECEIVED_AT });
  }

  it("does not touch a message that fits", () => {
    const url = reply("Hola, ¿tienen talla 7?");

    expect(bodyOf(url)).toContain("> Hola, ¿tienen talla 7?");
    expect(bodyOf(url)).not.toContain("…");
  });

  it("keeps the whole URL under the limit for a maximum-length message, using the room it has", () => {
    // 2000 characters is the longest message the contact form accepts.
    const url = reply("a".repeat(2000));

    expect(url.length).toBeLessThanOrEqual(MAX_REPLY_MAILTO_LENGTH);
    // ASCII costs one character each, so almost the whole budget is used.
    expect(url.length).toBeGreaterThanOrEqual(MAX_REPLY_MAILTO_LENGTH - 12);
    expect(bodyOf(url).endsWith("…")).toBe(true);
    expect(bodyOf(url)).toContain("\r\n> aaaa");
  });

  it("stays under the limit with the longest address the contact form accepts", () => {
    const longEmail = `${"a".repeat(148)}@example.com`;
    expect(longEmail).toHaveLength(160);

    const url = reply("b".repeat(2000), longEmail);

    expect(url.length).toBeLessThanOrEqual(MAX_REPLY_MAILTO_LENGTH);
    expect(bodyOf(url).endsWith("…")).toBe(true);
  });

  it.each([
    ["accented letters (6 encoded characters each)", "ñ".repeat(2000)],
    ["emoji (12 encoded characters each)", "😀".repeat(1000)],
    ["short lines (CRLF + '> ' on every line)", "x\n".repeat(1000)],
    ["lines separated by blank lines", "x\n\n".repeat(660)],
  ])("stays under the limit for %s", (_label, message) => {
    const url = reply(message);

    expect(url.length).toBeLessThanOrEqual(MAX_REPLY_MAILTO_LENGTH);
  });

  it("never splits a character: the cut quote decodes cleanly", () => {
    const url = reply("😀".repeat(1000));
    const decoded = bodyOf(url);

    expect(decoded).not.toContain("\uFFFD");
    expect(decoded.split("\r\n").at(-1)).toMatch(/^> (?:😀)+…$/u);
  });

  it("keeps every line of a cut quote prefixed with '> '", () => {
    const message = Array.from({ length: 200 }, (_, index) => `línea ${index}`).join("\n");
    const url = reply(message);
    // Two blank lines to type in, then the heading; the quote starts after.
    const quoted = bodyOf(url).split("\r\n").slice(3);

    expect(quoted.length).toBeGreaterThan(10);
    expect(quoted.every((line) => line.startsWith(">"))).toBe(true);
    expect(quoted.at(-1)?.endsWith("…")).toBe(true);
  });

  it("holds the limit at every message length, for mixed text", () => {
    const unit = "aá😀\nb ";
    for (let length = 1; length <= 2000; length += 37) {
      const message = unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
      const url = reply(message);

      expect(url.length).toBeLessThanOrEqual(MAX_REPLY_MAILTO_LENGTH);
      expect(() => decodeURIComponent(rawBodyOf(url))).not.toThrow();
    }
  });

  it("leaves out the quote when the address alone leaves no room for it", () => {
    const url = reply("Hola", `${"a".repeat(1900)}@example.com`);

    expect(bodyOf(url)).toBe("\r\n\r\n— Escribiste el 1 oct 2026, 9:30 p.m.:\r\n");
  });

  it("survives a lone surrogate half in the stored text", () => {
    const url = reply("antes \uD83D después");

    expect(() => new URL(url)).not.toThrow();
    expect(bodyOf(url)).toContain("> antes \uFFFD después");
  });
});
