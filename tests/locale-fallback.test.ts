import { describe, expect, it } from "vitest";
import { deepMergeMessages } from "../i18n/request";

// Exercises the fallback mechanism in isolation, without mocking next-intl's
// request lifecycle (see i18n/request.ts for why `deepMergeMessages` is
// exported standalone). Proves the literal spec requirement (brand-pages —
// Content Locale Fallback): a locale missing a namespace/key entirely still
// renders the ES draft content, never a blank string.
describe("deepMergeMessages — bilingual fallback", () => {
  it("fills a namespace missing entirely from the target locale with the base locale's content", () => {
    const base = { About: { title: "Título ES" }, Shop: { title: "Tienda" } };
    const target = { Shop: { title: "Shop" } }; // About missing entirely, e.g. EN not drafted yet

    const merged = deepMergeMessages(base, target);

    expect(merged.About.title).toBe("Título ES");
    expect(merged.Shop.title).toBe("Shop");
  });

  it("fills a single missing key within a namespace while keeping translated siblings", () => {
    const base = { About: { title: "Título ES", cta: "Ver piezas" } };
    const target = { About: { title: "Title EN" } }; // cta missing from EN

    const merged = deepMergeMessages(base, target);

    expect(merged.About.title).toBe("Title EN");
    expect(merged.About.cta).toBe("Ver piezas");
  });

  it("never renders blank/undefined for a key present in the base locale", () => {
    const base = { Contact: { submit: "Enviar" } };
    const target = {};

    const merged = deepMergeMessages(base, target);

    expect(merged.Contact.submit).toBe("Enviar");
    expect(merged.Contact.submit).not.toBeUndefined();
  });

  it("leaves the base locale itself untouched when merged with an empty override", () => {
    const base = { About: { title: "Título ES" } };

    const merged = deepMergeMessages(base, {});

    expect(merged).toEqual(base);
  });
});
