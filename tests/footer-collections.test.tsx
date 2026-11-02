// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "../messages/en.json";
import esMessages from "../messages/es.json";

type Locale = "es" | "en";

const MESSAGES = { es: esMessages, en: enMessages };

// Same approach as tests/header-nav.test.tsx: `next-intl/server` is mocked on
// top of the real message files, so the labels asserted are the actual copy.
vi.mock("next-intl/server", () => ({
  getTranslations: async ({
    locale,
    namespace,
  }: {
    locale: string;
    namespace: string;
  }) => {
    const scoped = (
      MESSAGES as unknown as Record<string, Record<string, Record<string, string>>>
    )[locale][namespace];
    return (key: string) => scoped[key];
  },
}));

import { Footer } from "../components/layout/Footer";

async function renderFooter(locale: Locale) {
  const jsx = await Footer({ locale });
  render(
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]}>
      {jsx}
    </NextIntlClientProvider>,
  );
  return within(screen.getByRole("navigation", { name: "Footer" }));
}

describe("Footer — Colecciones link", () => {
  it("links the collections index, between Tienda and Nosotros", async () => {
    const nav = await renderFooter("es");

    const links = nav.getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      "Tienda",
      "Colecciones",
      "Nosotros",
      "Contacto",
    ]);
    expect(nav.getByRole("link", { name: "Colecciones" })).toHaveAttribute(
      "href",
      "/es/colecciones",
    );
  });

  it("says Collections and keeps the locale in English", async () => {
    const nav = await renderFooter("en");

    expect(nav.getByRole("link", { name: "Collections" })).toHaveAttribute(
      "href",
      "/en/colecciones",
    );
  });

  it("styles it like the other footer links", async () => {
    const nav = await renderFooter("es");

    const shared = ["w-fit", "text-ink", "transition-colors", "hover:text-brass-deep"];
    for (const name of ["Tienda", "Colecciones"]) {
      const classes = nav.getByRole("link", { name }).className.split(/\s+/);
      for (const token of shared) {
        expect(classes).toContain(token);
      }
    }
  });
});
