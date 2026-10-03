// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "../messages/en.json";
import esMessages from "../messages/es.json";

type Locale = "es" | "en";

const MESSAGES = { es: esMessages, en: enMessages };

// `next-intl/server` is mocked on top of the real message files (same approach
// as tests/shop-catalog.test.tsx), so the labels asserted below are the actual
// copy, not echoed keys.
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

vi.mock("@/lib/site-settings/adapter", () => ({
  getSiteSettings: async () => ({ logo: null, hero: null, heroAlt: null }),
}));

// The cart trigger and the language toggle are client islands with their own
// behavior (they need the cart provider and the router); stubs keep this file
// on the nav links the Header itself renders.
vi.mock("@/components/layout/CartTrigger", () => ({
  CartTrigger: () => <button type="button">cart-stub</button>,
}));
vi.mock("@/components/layout/LocaleSwitcher", () => ({
  LocaleSwitcher: () => <span>locale-stub</span>,
}));

import { Header } from "../components/layout/Header";

async function renderHeader(locale: Locale) {
  const jsx = await Header({ locale });
  render(
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]}>
      {jsx}
    </NextIntlClientProvider>,
  );
  return within(screen.getByRole("navigation", { name: "Primary" }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Header — Inicio link", () => {
  it("links home from the nav, before Tienda", async () => {
    const nav = await renderHeader("es");

    const links = nav.getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(["Inicio", "Tienda"]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/es",
      "/es/shop",
    ]);
  });

  it("says Home and keeps the locale in English", async () => {
    const nav = await renderHeader("en");

    expect(nav.getAllByRole("link").map((link) => link.textContent)).toEqual([
      "Home",
      "Shop",
    ]);
    expect(nav.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/en");
  });

  it("styles it like the Tienda link", async () => {
    const nav = await renderHeader("es");

    const shared = ["font-sans", "text-sm", "text-ink", "transition-colors", "hover:text-brass-deep"];
    for (const name of ["Inicio", "Tienda"]) {
      const classes = nav.getByRole("link", { name }).className.split(/\s+/);
      for (const token of shared) {
        expect(classes).toContain(token);
      }
    }
  });

  it("is dropped below the sm breakpoint, where the header has no room for it", async () => {
    const nav = await renderHeader("es");

    const classes = nav.getByRole("link", { name: "Inicio" }).className.split(/\s+/);
    expect(classes).toContain("hidden");
    expect(classes).toContain("sm:inline");
    // The shop link is always visible.
    expect(nav.getByRole("link", { name: "Tienda" }).className.split(/\s+/)).not.toContain(
      "hidden",
    );
  });

  it("keeps the logo link home", async () => {
    await renderHeader("es");

    const logoLink = screen.getByRole("img", { name: "nerea" }).closest("a");
    expect(logoLink).toHaveAttribute("href", "/es");
  });
});
