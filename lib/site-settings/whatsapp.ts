// Pure WhatsApp helpers for the atelier's contact number (the optional
// `whatsappNumber` field of the "siteSettings" singleton, see
// sanity/schemaTypes/siteSettings.ts). No I/O and no framework imports on
// purpose: the Studio schema imports the validator by RELATIVE path (the Studio
// build does not resolve the `@/` alias), Server Components build links with
// it, and CartDrawer (a client component) bundles it.
//
// wa.me wants the full international number as digits only — no "+", spaces or
// dashes — e.g. 5215512345678 for a Mexican mobile (country code 52 + 1 + ten
// digits). E.164 caps a number at 15 digits; anything under 10 cannot be a
// complete number with a country code.
const MIN_DIGITS = 10;
const MAX_DIGITS = 15;

const DIGITS_ONLY = new RegExp(`^\\d{${MIN_DIGITS},${MAX_DIGITS}}$`);

const STUDIO_ERROR =
  "Escribe solo dígitos, de 10 a 15, con la lada de tu país (p. ej. 5215512345678).";

/**
 * Studio validation for the optional `whatsappNumber` field: an empty field is
 * fine; anything else must be digits only, 10 to 15 long. Returns `true` or a
 * Spanish message for the artisan, as Sanity's `rule.custom()` expects.
 */
export function validateWhatsappNumberInput(value: unknown): true | string {
  if (value === undefined || value === null || value === "") {
    return true;
  }
  return typeof value === "string" && DIGITS_ONLY.test(value)
    ? true
    : STUDIO_ERROR;
}

/**
 * Reduces a stored value to the digits wa.me expects, or `undefined` when it
 * cannot be a usable number. Lenient about FORMATTING ("+52 55 1234 5678"
 * becomes "525512345678") because a document can be edited outside Studio's
 * validation, strict about LENGTH (10 to 15 digits). `undefined` means "no
 * WhatsApp number": consumers render no link at all.
 */
export function normalizeWhatsappNumber(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const digits = raw.replace(/\D/g, "");
  return digits.length >= MIN_DIGITS && digits.length <= MAX_DIGITS
    ? digits
    : undefined;
}

/**
 * `https://wa.me/<digits>?text=<encoded text>`, or `undefined` when there is no
 * usable number. The number is normalized again here, so only digits can ever
 * reach the URL path; the pre-filled text is percent-encoded in full. An empty
 * text yields the bare chat link.
 */
export function buildWhatsappUrl(
  number: string | null | undefined,
  text: string,
): string | undefined {
  const digits = normalizeWhatsappNumber(number);
  if (!digits) {
    return undefined;
  }
  const base = `https://wa.me/${digits}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}
