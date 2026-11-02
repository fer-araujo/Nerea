import { describe, expect, it, vi } from "vitest";

// `defineType` / `defineField` are identity helpers at runtime (they exist for
// type inference), so mocking them lets the schema files load without pulling
// in the whole Studio package. What is asserted is the Studio-facing contract:
// field names, Spanish copy, the allowed values and their defaults.
vi.mock("sanity", () => ({
  defineType: (definition: unknown) => definition,
  defineField: (definition: unknown) => definition,
}));

import {
  INHERIT_PURCHASE_OPTION,
  resolveProductOptions,
} from "@/lib/commerce/options";
import { category } from "@/sanity/schemaTypes/category";
import { collection } from "@/sanity/schemaTypes/collection";
import { schemaTypes } from "@/sanity/schemaTypes";
import { product } from "@/sanity/schemaTypes/product";
import { siteSettings } from "@/sanity/schemaTypes/siteSettings";

interface FieldLike {
  name: string;
  title?: string;
  description?: string;
  type: string;
  initialValue?: unknown;
  of?: { type: string; to?: { type: string }[] }[];
  fields?: FieldLike[];
  options?: { list?: { title: string; value: string }[]; layout?: string };
  validation?: (rule: unknown) => unknown;
}

function fieldOf(schema: unknown, name: string): FieldLike {
  const fields = (schema as { fields: FieldLike[] }).fields;
  const field = fields.find((candidate) => candidate.name === name);
  if (!field) {
    throw new Error(`Field "${name}" not found`);
  }
  return field;
}

const TITLES_AND_VALUES = (field: FieldLike) =>
  (field.options?.list ?? []).map(({ title, value }) => [title, value]);

describe("siteSettings.whatsappNumber", () => {
  const field = fieldOf(siteSettings, "whatsappNumber");

  it("is a string with the Spanish title and description", () => {
    expect(field.type).toBe("string");
    expect(field.title).toBe("Número de WhatsApp");
    expect(field.description).toBe(
      "Con lada de país, solo dígitos, p. ej. 5215512345678",
    );
  });

  // The Studio rule, exercised through a stub: `custom` is the only method the
  // schema may call, so a `required()` (which the stub lacks) would throw.
  function studioValidator(): (value: unknown) => unknown {
    let captured: ((value: unknown) => unknown) | undefined;
    const rule = {
      custom(validator: (value: unknown) => unknown) {
        captured = validator;
        return rule;
      },
    };
    field.validation?.(rule);
    if (!captured) {
      throw new Error("The field registered no custom validation");
    }
    return captured;
  }

  it.each([undefined, null, ""])("is optional: %j passes", (value) => {
    expect(studioValidator()(value)).toBe(true);
  });

  it.each(["5215512345678", "1234567890", "123456789012345"])(
    "accepts %s (digits only, 10 to 15 long)",
    (value) => {
      expect(studioValidator()(value)).toBe(true);
    },
  );

  it.each([
    "123456789",
    "1234567890123456",
    "+5215512345678",
    "52 1 55 1234 5678",
    "abc",
  ])("rejects %j with a Spanish message", (value) => {
    const result = studioValidator()(value);

    expect(typeof result).toBe("string");
    expect(result).toContain("dígitos");
  });
});

describe("category.purchaseOption", () => {
  const field = fieldOf(category, "purchaseOption");

  it("is a radio of Ninguna / Talla de anillo / Largo de cadena, defaulting to none", () => {
    expect(field.type).toBe("string");
    expect(field.title).toBe("Opción de compra");
    expect(field.options?.layout).toBe("radio");
    expect(TITLES_AND_VALUES(field)).toEqual([
      ["Ninguna", "none"],
      ["Talla de anillo", "ringSize"],
      ["Largo de cadena", "chainLength"],
    ]);
    expect(field.initialValue).toBe("none");
  });

  it("explains in Spanish that it applies to the whole category", () => {
    expect(field.description).toBe(
      "Se aplica a todas las piezas de esta categoría, salvo que la pieza indique otra",
    );
  });
});

describe("product.purchaseOption", () => {
  const field = fieldOf(product, "purchaseOption");

  it('offers "Según la categoría" first and makes it the default', () => {
    expect(field.options?.layout).toBe("radio");
    expect(TITLES_AND_VALUES(field)).toEqual([
      ["Según la categoría", "inherit"],
      ["Ninguna", "none"],
      ["Talla de anillo", "ringSize"],
      ["Largo de cadena", "chainLength"],
    ]);
    expect(field.initialValue).toBe("inherit");
    expect(INHERIT_PURCHASE_OPTION).toBe("inherit");
  });

  it("only offers values the resolver understands, with the intended meaning", () => {
    const values = (field.options?.list ?? []).map((option) => option.value);
    const underRingCategory = values.map((purchaseOption) =>
      resolveProductOptions({
        purchaseOption,
        categoryPurchaseOption: "ringSize",
      }).kind,
    );

    // inherit -> the category's (ring size); the explicit three override it.
    expect(underRingCategory).toEqual([
      "ringSize",
      "none",
      "ringSize",
      "chainLength",
    ]);
    expect(
      values.map(
        (purchaseOption) =>
          resolveProductOptions({
            purchaseOption,
            categoryPurchaseOption: "chainLength",
          }).kind,
      ),
    ).toEqual(["chainLength", "none", "ringSize", "chainLength"]);
  });
});

describe("collection schema", () => {
  it("is registered with the other document types, next to the categories", () => {
    const names = schemaTypes.map((type) => type.name);

    expect(names).toContain("collection");
    expect(names.indexOf("collection")).toBe(names.indexOf("category") + 1);
    expect(collection.type).toBe("document");
    expect(collection.title).toBe("Colección");
  });

  it("carries a bilingual title (Spanish required), a slug and a bilingual description", () => {
    const title = fieldOf(collection, "title");
    expect(title.type).toBe("object");
    expect(title.title).toBe("Nombre");
    expect((title.fields ?? []).map((field) => field.name)).toEqual(["es", "en"]);

    expect(fieldOf(collection, "slug").type).toBe("slug");

    const description = fieldOf(collection, "description");
    expect(description.type).toBe("object");
    expect((description.fields ?? []).map((field) => field.name)).toEqual(["es", "en"]);
  });

  it("is on by default and can be switched off", () => {
    const active = fieldOf(collection, "active");

    expect(active.type).toBe("boolean");
    expect(active.title).toBe("Activa");
    expect(active.initialValue).toBe(true);
  });

  it("offers an optional closing date and a numeric order", () => {
    const endsAt = fieldOf(collection, "endsAt");
    expect(endsAt.type).toBe("datetime");
    expect(endsAt.title).toBe("Fecha de cierre (opcional)");
    // Optional: no required() rule at all.
    expect(endsAt.validation).toBeUndefined();

    const order = fieldOf(collection, "order");
    expect(order.type).toBe("number");
    expect(order.title).toBe("Orden");
  });

  describe("cover", () => {
    const cover = fieldOf(collection, "cover");

    // The rule, run through a stub: `custom` is the only method the schema may
    // call, so anything else it reached for would throw.
    function validate(value: unknown): unknown {
      let captured: ((value: unknown) => unknown) | undefined;
      const rule = {
        custom(validator: (value: unknown) => unknown) {
          captured = validator;
          return rule;
        },
      };
      cover.validation?.(rule);
      if (!captured) {
        throw new Error("The cover registered no custom validation");
      }
      return captured(value);
    }

    it("is an optional image with a bilingual alt text", () => {
      expect(cover.type).toBe("image");
      const alt = (cover.fields ?? []).find((field) => field.name === "alt");
      expect(alt?.type).toBe("object");
      expect((alt?.fields ?? []).map((field) => field.name)).toEqual(["es", "en"]);
    });

    it.each([undefined, null, {}])("passes when there is no image: %j", (value) => {
      expect(validate(value)).toBe(true);
    });

    it("requires the Spanish alt text once an image is set", () => {
      const result = validate({ asset: { _ref: "image-abc" } });

      expect(typeof result).toBe("string");
      expect(result).toContain("texto alternativo");
      expect(validate({ asset: { _ref: "image-abc" }, alt: { es: "  " } })).toEqual(
        result,
      );
    });

    it("accepts an image whose alt text is written", () => {
      expect(
        validate({ asset: { _ref: "image-abc" }, alt: { es: "Velas y cempasúchil" } }),
      ).toBe(true);
    });
  });
});

describe("product.collections", () => {
  const field = fieldOf(product, "collections");

  it("is an optional many-to-many list of references to collections", () => {
    expect(field.type).toBe("array");
    expect(field.title).toBe("Colecciones");
    expect(field.of).toEqual([{ type: "reference", to: [{ type: "collection" }] }]);
    // Optional: a piece in no collection is the normal case.
    const rule = { unique: () => "unique-only" };
    expect(field.validation?.(rule)).toBe("unique-only");
  });

  it("sits next to the single-valued category", () => {
    const names = ((product as unknown as { fields: FieldLike[] }).fields).map(
      (candidate) => candidate.name,
    );

    expect(names.indexOf("collections")).toBe(names.indexOf("category") + 1);
    expect(fieldOf(product, "category").type).toBe("reference");
  });
});
