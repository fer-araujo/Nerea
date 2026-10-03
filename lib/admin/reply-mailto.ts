// Pure helpers behind the admin inbox's mailto: links (see
// app/admin/(panel)/mensajes/page.tsx). No I/O and no framework imports, so
// they run in plain node tests.
//
// SECURITY: the stored email and message are visitor-supplied. In a mailto:
// URL, "?", "&", "=", "#" and "," are what a mail client reads as header
// fields or extra recipients (a smuggled "?bcc=..." or "&cc=..."), and a raw
// line break could start a new header. So every visitor-controlled value goes
// through encodeURIComponent, which leaves those characters only as %XX.

/** Subject of the reply draft. */
export const REPLY_SUBJECT = "Re: tu mensaje a nerea";

// Browsers and mail clients start dropping or mangling very long mailto: URLs
// well before the ~2000-character folklore limit, so the whole URL (not just
// the body) is kept under this.
export const MAX_REPLY_MAILTO_LENGTH = 1800;

// Marks where the quoted message was cut. A single character, like the rest of
// the copy, so it never reads as part of the visitor's own words.
const ELLIPSIS = "…";

// RFC 6068 asks for CRLF line breaks inside a mailto: body.
const LINE_BREAK = "\r\n";

// encodeURIComponent throws a URIError on a lone surrogate half. Stored text
// should never contain one (Firestore stores UTF-8), but a throw here would
// take the whole inbox page down, so anything malformed becomes U+FFFD.
// Code-point iteration also means a later cut can never split a surrogate pair.
function toCodePoints(text: string): string[] {
  return Array.from(text, (character) => {
    const unit = character.charCodeAt(0);
    const isLoneSurrogate =
      character.length === 1 && unit >= 0xd800 && unit <= 0xdfff;
    return isLoneSurrogate ? "�" : character;
  });
}

function encodedLength(text: string): number {
  return encodeURIComponent(text).length;
}

// The address was validated on the way in, but it is still visitor-supplied
// data. "@" is restored after encoding because mail clients expect it literal
// in the recipient.
function encodeRecipient(email: string): string {
  return encodeURIComponent(toCodePoints(email).join("")).replace(/%40/g, "@");
}

/** `mailto:` link to the stored address, with no subject or body. */
export function mailtoHref(email: string): string {
  return `mailto:${encodeRecipient(email)}`;
}

// "> " in front of every line; blank lines get a bare ">" (no trailing space).
function quote(text: string): string {
  return text
    .split("\n")
    .map((line) => (line === "" ? ">" : `> ${line}`))
    .join(LINE_BREAK);
}

// Quotes `message` so that the percent-encoded result fits in `budget`
// characters. A message that is too long is cut at a code-point boundary
// (largest prefix that still fits, found by binary search because the encoded
// length only ever grows with the prefix) and ends with an ellipsis. Returns ""
// when not even the ellipsis fits.
function quoteWithinBudget(message: string, budget: number): string {
  const text = toCodePoints(message).join("").replace(/\r\n?/g, "\n").trim();
  if (text === "" || budget <= 0) {
    return "";
  }
  if (encodedLength(quote(text)) <= budget) {
    return quote(text);
  }

  const characters = Array.from(text);
  const candidate = (count: number) =>
    quote(characters.slice(0, count).join("").trimEnd() + ELLIPSIS);

  let kept = 0;
  let high = characters.length;
  while (kept < high) {
    const middle = Math.ceil((kept + high) / 2);
    if (encodedLength(candidate(middle)) <= budget) {
      kept = middle;
    } else {
      high = middle - 1;
    }
  }
  const best = candidate(kept);
  return encodedLength(best) <= budget ? best : "";
}

// The "received at" label comes pre-formatted from the page. Some ICU versions
// put a narrow no-break space before "p. m."; a plain space reads the same in
// a mail draft and keeps the text stable across runtimes.
function cleanDateLabel(label: string | null | undefined): string {
  return (label ?? "").replace(/[  ]/g, " ").trim();
}

export interface ReplyMailtoInput {
  /** The visitor's address, as stored. */
  email: string;
  /** The visitor's original message, as stored. */
  message: string;
  /** When it arrived, already formatted in the atelier's time zone (Mexico City). */
  receivedAt?: string | null;
}

/**
 * `mailto:` link that opens a reply draft: To = the stored address, subject
 * "Re: tu mensaje a nerea", and a body that leaves room to type and then
 * quotes the original message as "> " lines under "— Escribiste el <fecha>:".
 * Everything visitor-supplied is percent-encoded, and the quote is truncated
 * so the whole URL stays within MAX_REPLY_MAILTO_LENGTH.
 */
export function buildReplyMailto({
  email,
  message,
  receivedAt,
}: ReplyMailtoInput): string {
  const base =
    `${mailtoHref(email)}?subject=${encodeURIComponent(REPLY_SUBJECT)}&body=`;

  const date = cleanDateLabel(receivedAt);
  const heading = date ? `— Escribiste el ${date}:` : "— Escribiste:";
  const lead = encodeURIComponent(
    `${LINE_BREAK}${LINE_BREAK}${heading}${LINE_BREAK}`,
  );

  const budget = MAX_REPLY_MAILTO_LENGTH - base.length - lead.length;
  return base + lead + encodeURIComponent(quoteWithinBudget(message, budget));
}
