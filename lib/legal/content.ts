// Copy for the legal pages (privacy notice, purchase terms, shipping and
// returns). It lives in messages/{locale}.json under `Legal` as structured
// plain text — a title and sections made of paragraphs and bullet items — so a
// lawyer or translator edits JSON strings, never markup. React renders every
// string as an escaped text node; nothing here is ever treated as HTML.
//
// The facts that are not known yet (the owner's name, address, contact details,
// delivery times) are `Legal.values`, written as bracketed UPPERCASE
// placeholders such as "[DOMICILIO]". The texts refer to them as {owner},
// {address}, ... so each fact is typed once per language, in one block. While
// any placeholder survives in a document, its page shows the "draft pending
// review" note, and the note disappears on its own after the last one is
// replaced — there is no flag to remember to switch off.

export const LEGAL_NAMESPACE = "Legal";

export const LEGAL_DOCUMENT_KEYS = ["privacy", "terms", "shipping"] as const;
export type LegalDocumentKey = (typeof LEGAL_DOCUMENT_KEYS)[number];

export interface LegalSection {
  title: string;
  paragraphs: string[];
  /** Bullet list rendered after the paragraphs. Empty when the section has none. */
  items: string[];
}

export interface LegalDocument {
  kicker: string;
  title: string;
  /** "Last updated: <date>" line, already filled in. */
  updated: string;
  intro: string;
  sections: LegalSection[];
  /** True while any bracketed placeholder is left anywhere in the document. */
  isDraft: boolean;
}

// Bracketed text made only of uppercase letters, digits and light punctuation:
// "[DOMICILIO]", "[PLAZO DE ENTREGA]", "[TELÉFONO DE CONTACTO]".
const PLACEHOLDER = /\[[A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑ0-9 .,:/()-]*\]/;

// A reference to one of the `Legal.values` entries, e.g. "{owner}".
const VALUE_REFERENCE = /\{(\w+)\}/g;

export function hasPlaceholder(text: string): boolean {
  return PLACEHOLDER.test(text);
}

/**
 * Replaces each "{name}" with its entry in `values`. An unknown name is left
 * as written, so a typo shows up on the page (and in the legal-copy test)
 * instead of silently turning into an empty string.
 */
export function fillValues(
  text: string,
  values: Record<string, string>,
): string {
  return text.replace(VALUE_REFERENCE, (reference, name: string) =>
    Object.hasOwn(values, name) ? values[name] : reference,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// The messages are static JSON checked in CI, but they are typed `unknown` at
// this boundary: a wrong shape fails loudly here (the build, for these static
// pages) instead of rendering a half-empty legal page.
function readString(
  source: Record<string, unknown>,
  key: string,
  path: string,
): string {
  const value = source[key];
  if (typeof value !== "string") {
    throw new Error(`Legal copy: "${path}.${key}" must be a string.`);
  }
  return value;
}

function readStringList(
  source: Record<string, unknown>,
  key: string,
  path: string,
): string[] {
  const value = source[key];
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`Legal copy: "${path}.${key}" must be a list of strings.`);
  }
  return value as string[];
}

function readValues(raw: unknown): Record<string, string> {
  if (!isRecord(raw)) {
    throw new Error('Legal copy: "Legal.values" must be an object.');
  }
  const values: Record<string, string> = {};
  for (const name of Object.keys(raw)) {
    values[name] = readString(raw, name, "Legal.values");
  }
  return values;
}

function readSection(
  raw: unknown,
  path: string,
  fill: (text: string) => string,
): LegalSection {
  if (!isRecord(raw)) {
    throw new Error(`Legal copy: "${path}" must be an object.`);
  }
  return {
    title: fill(readString(raw, "title", path)),
    paragraphs: readStringList(raw, "paragraphs", path).map(fill),
    items: readStringList(raw, "items", path).map(fill),
  };
}

function textOf(document: Omit<LegalDocument, "isDraft">): string[] {
  return [
    document.kicker,
    document.title,
    document.updated,
    document.intro,
    ...document.sections.flatMap((section) => [
      section.title,
      ...section.paragraphs,
      ...section.items,
    ]),
  ];
}

/**
 * Reads one legal document out of the `Legal` messages namespace, fills in its
 * `{value}` references and works out whether it is still a draft.
 *
 * @param legal The `Legal` namespace of the locale's messages.
 */
export function readLegalDocument(
  legal: unknown,
  key: LegalDocumentKey,
): LegalDocument {
  if (!isRecord(legal)) {
    throw new Error(`Legal copy: the "${LEGAL_NAMESPACE}" namespace is missing.`);
  }

  const path = `${LEGAL_NAMESPACE}.${key}`;
  const raw = legal[key];
  if (!isRecord(raw)) {
    throw new Error(`Legal copy: "${path}" is missing.`);
  }
  if (!Array.isArray(raw.sections)) {
    throw new Error(`Legal copy: "${path}.sections" must be a list.`);
  }

  const values = readValues(legal.values);
  const fill = (text: string) => fillValues(text, values);

  const document = {
    kicker: fill(readString(raw, "kicker", path)),
    title: fill(readString(raw, "title", path)),
    updated: fill(readString(legal, "updatedLabel", LEGAL_NAMESPACE)),
    intro: fill(readString(raw, "intro", path)),
    sections: raw.sections.map((section, index) =>
      readSection(section, `${path}.sections.${index}`, fill),
    ),
  };

  return { ...document, isDraft: textOf(document).some(hasPlaceholder) };
}

/**
 * Drops the legal copy from the messages handed to NextIntlClientProvider. It
 * is long and only ever rendered by Server Components, so shipping it to the
 * client would add it to the payload of every page for nothing.
 */
export function omitLegalCopy<T extends Record<string, unknown>>(
  messages: T,
): Omit<T, typeof LEGAL_NAMESPACE> {
  return Object.fromEntries(
    Object.entries(messages).filter(
      ([namespace]) => namespace !== LEGAL_NAMESPACE,
    ),
  ) as Omit<T, typeof LEGAL_NAMESPACE>;
}
