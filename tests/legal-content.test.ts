import { describe, expect, it } from "vitest";
import esMessages from "../messages/es.json";
import enMessages from "../messages/en.json";
import {
  LEGAL_DOCUMENT_KEYS,
  fillValues,
  hasPlaceholder,
  omitLegalCopy,
  readLegalDocument,
  type LegalDocument,
} from "../lib/legal/content";

const LOCALES = [
  { locale: "es", messages: esMessages },
  { locale: "en", messages: enMessages },
] as const;

function textOf(document: LegalDocument): string {
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
  ].join("\n");
}

describe("hasPlaceholder", () => {
  it.each([
    "[DOMICILIO]",
    "[PLAZO DE ENTREGA]",
    "[TELÉFONO DE CONTACTO]",
    "[FECHA DE ACTUALIZACIÓN]",
    "[MADE-TO-SIZE FITTING TIME]",
    "Escríbenos a [CORREO DE CONTACTO] para más información.",
  ])("recognizes %s", (text) => {
    expect(hasPlaceholder(text)).toBe(true);
  });

  it.each([
    "",
    "Sin datos pendientes.",
    "[nota]",
    "[Domicilio]",
    "[1]",
    "{owner}",
    "(DOMICILIO)",
  ])("ignores %j", (text) => {
    expect(hasPlaceholder(text)).toBe(false);
  });
});

describe("fillValues", () => {
  it("replaces every reference with its value", () => {
    expect(
      fillValues("{owner} vive en {address}. {owner}.", {
        owner: "Ana",
        address: "Oaxaca",
      }),
    ).toBe("Ana vive en Oaxaca. Ana.");
  });

  it("leaves an unknown reference as written, so a typo stays visible", () => {
    expect(fillValues("Hola {nobody}", { owner: "Ana" })).toBe("Hola {nobody}");
  });

  it("never resolves a reference through the object prototype", () => {
    expect(fillValues("{constructor} {toString}", {})).toBe(
      "{constructor} {toString}",
    );
  });
});

describe.each(LOCALES)("legal copy ($locale)", ({ messages }) => {
  const legal = messages.Legal;

  it.each(LEGAL_DOCUMENT_KEYS)("%s: reads as a complete, filled-in document", (key) => {
    const document = readLegalDocument(legal, key);

    expect(document.title).not.toBe("");
    expect(document.intro).not.toBe("");
    expect(document.sections.length).toBeGreaterThan(0);
    for (const section of document.sections) {
      expect(section.title).not.toBe("");
      expect(section.paragraphs.length).toBeGreaterThan(0);
    }
    // Every {value} reference resolves: a leftover brace is a typo.
    expect(textOf(document)).not.toMatch(/\{\w+\}/);
  });

  it.each(LEGAL_DOCUMENT_KEYS)("%s: is plain text, never markup", (key) => {
    const text = textOf(readLegalDocument(legal, key));

    expect(text).not.toMatch(/[<>]/);
  });

  it("stays a draft while its placeholders are unfilled", () => {
    for (const key of LEGAL_DOCUMENT_KEYS) {
      expect(readLegalDocument(legal, key).isDraft).toBe(true);
    }
  });

  it("stops being a draft once every value is filled in", () => {
    const filled = {
      ...legal,
      values: Object.fromEntries(
        Object.keys(legal.values).map((name) => [name, `value of ${name}`]),
      ),
    };

    for (const key of LEGAL_DOCUMENT_KEYS) {
      const document = readLegalDocument(filled, key);

      expect(document.isDraft).toBe(false);
      // Every document shows its update date, filled from the same block.
      expect(textOf(document)).toContain("value of updated");
    }
  });

  it("still flags a document as a draft when a placeholder is typed straight into its text", () => {
    const edited = {
      ...legal,
      values: Object.fromEntries(
        Object.keys(legal.values).map((name) => [name, "filled"]),
      ),
      terms: {
        ...legal.terms,
        intro: "Texto con un dato pendiente: [RFC].",
      },
    };

    expect(readLegalDocument(edited, "terms").isDraft).toBe(true);
    expect(readLegalDocument(edited, "privacy").isDraft).toBe(false);
  });

  // The controller's identity and the processors are what the privacy notice
  // exists to state: pin them so an edit cannot quietly drop one.
  it("privacy notice names the controller, the ARCO rights and every processor", () => {
    const text = textOf(readLegalDocument(legal, "privacy"));

    expect(text).toContain(legal.values.owner);
    expect(text).toContain(legal.values.address);
    expect(text).toContain(legal.values.email);
    expect(text).toContain("ARCO");
    for (const processor of ["Stripe", "Firebase", "Sanity", "Netlify"]) {
      expect(text).toContain(processor);
    }
  });
});

describe("legal copy — es and en line up", () => {
  const es = esMessages.Legal;
  const en = enMessages.Legal;

  it("fills in the same facts in both languages", () => {
    expect(Object.keys(en.values).sort()).toEqual(Object.keys(es.values).sort());
  });

  it.each(LEGAL_DOCUMENT_KEYS)(
    "%s: has the same sections, paragraphs and items in both languages",
    (key) => {
      const shape = (document: LegalDocument) =>
        document.sections.map((section) => [
          section.paragraphs.length,
          section.items.length,
        ]);

      expect(shape(readLegalDocument(en, key))).toEqual(
        shape(readLegalDocument(es, key)),
      );
    },
  );

  it("has page titles and footer links for every legal page in both languages", () => {
    for (const { messages } of LOCALES) {
      for (const key of LEGAL_DOCUMENT_KEYS) {
        expect(messages.Meta[key].title).toBeTruthy();
        expect(messages.Meta[key].description).toBeTruthy();
        expect(messages.Footer[key]).toBeTruthy();
      }
    }
  });
});

describe("readLegalDocument — malformed copy", () => {
  it("throws when the namespace is missing", () => {
    expect(() => readLegalDocument(undefined, "privacy")).toThrow(/namespace/);
  });

  it("throws when a document is missing", () => {
    const withoutPrivacy = Object.fromEntries(
      Object.entries(esMessages.Legal).filter(([name]) => name !== "privacy"),
    );

    expect(() => readLegalDocument(withoutPrivacy, "privacy")).toThrow(
      /Legal\.privacy/,
    );
  });

  it("throws on a section that is not an object", () => {
    const broken = {
      ...esMessages.Legal,
      privacy: { ...esMessages.Legal.privacy, sections: ["not a section"] },
    };

    expect(() => readLegalDocument(broken, "privacy")).toThrow(/sections\.0/);
  });

  it("throws when a paragraph is not a string", () => {
    const broken = {
      ...esMessages.Legal,
      privacy: {
        ...esMessages.Legal.privacy,
        sections: [{ title: "1. Título", paragraphs: [42] }],
      },
    };

    expect(() => readLegalDocument(broken, "privacy")).toThrow(/paragraphs/);
  });
});

describe("omitLegalCopy", () => {
  it("drops only the Legal namespace, leaving the rest and the input untouched", () => {
    const messages = { Cart: { title: "Carrito" }, Legal: { big: "text" } };

    expect(omitLegalCopy(messages)).toEqual({ Cart: { title: "Carrito" } });
    expect(messages.Legal).toEqual({ big: "text" });
  });

  it("keeps every namespace the client components read", () => {
    const clientMessages = omitLegalCopy(esMessages);

    expect(Object.keys(clientMessages)).toEqual(
      expect.arrayContaining(["Cart", "Contact", "ProductDetail", "Nav"]),
    );
    expect(clientMessages).not.toHaveProperty("Legal");
  });
});
