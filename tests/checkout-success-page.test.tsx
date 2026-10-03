// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "../messages/en.json";
import esMessages from "../messages/es.json";
import type { SiteSettings } from "../lib/site-settings/types";

type Locale = "es" | "en";

const MESSAGES = { es: esMessages, en: enMessages };

// `next-intl/server` resolves to its client-only stub outside a real Next.js
// request, so it is mocked to render this Server Component directly (same
// approach as tests/shop-catalog.test.tsx). The mock reads the real message
// files, so the assertions prove the actual localized copy renders.
const requestState = vi.hoisted(() => ({ locale: "es" }));

vi.mock("next-intl/server", () => ({
  setRequestLocale: (locale: string) => {
    requestState.locale = locale;
  },
  getTranslations: async (
    arg: string | { locale: string; namespace: string },
  ) => {
    const namespace = typeof arg === "string" ? arg : arg.namespace;
    const locale = typeof arg === "string" ? requestState.locale : arg.locale;
    const scoped = (
      MESSAGES as unknown as Record<string, Record<string, Record<string, string>>>
    )[locale][namespace];
    return (key: string) => scoped[key];
  },
}));

// The site settings come from Sanity; the page only cares about the number.
const getSiteSettingsMock = vi.fn();
vi.mock("@/lib/site-settings/adapter", () => ({
  getSiteSettings: (...args: unknown[]) => getSiteSettingsMock(...args),
}));

import CheckoutSuccessPage from "../app/[locale]/checkout/success/page";

const NUMBER = "5215512345678";

async function renderPage(locale: Locale, settings: Partial<SiteSettings> = {}) {
  getSiteSettingsMock.mockResolvedValue({
    logo: null,
    hero: null,
    heroAlt: null,
    ...settings,
  });
  const jsx = await CheckoutSuccessPage({ params: Promise.resolve({ locale }) });
  // The page's links are next-intl's, so they need the provider a real layout
  // supplies.
  render(
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]}>
      {jsx}
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("checkout success page — follow-up CTAs", () => {
  it("offers a WhatsApp chat (new tab, no opener) and a contact link after the confirmation", async () => {
    await renderPage("es", { whatsappNumber: NUMBER });

    const whatsapp = screen.getByRole("link", { name: "Escríbenos por WhatsApp" });
    expect(whatsapp).toHaveAttribute(
      "href",
      `https://wa.me/${NUMBER}?text=${encodeURIComponent(esMessages.Checkout.whatsappText)}`,
    );
    expect(whatsapp).toHaveAttribute("target", "_blank");
    expect(whatsapp).toHaveAttribute("rel", "noopener noreferrer");

    const message = screen.getByRole("link", { name: "Déjanos un mensaje" });
    expect(message).toHaveAttribute("href", "/es/contact");

    // They follow the confirmation copy.
    const body = screen.getByText(esMessages.Checkout.successBody);
    expect(
      body.compareDocumentPosition(whatsapp) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      body.compareDocumentPosition(message) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("localizes the labels, the pre-filled text and the contact link in English", async () => {
    await renderPage("en", { whatsappNumber: NUMBER });

    expect(
      screen.getByRole("link", { name: "Message us on WhatsApp" }),
    ).toHaveAttribute(
      "href",
      `https://wa.me/${NUMBER}?text=${encodeURIComponent(enMessages.Checkout.whatsappText)}`,
    );
    expect(
      screen.getByRole("link", { name: "Leave us a message" }),
    ).toHaveAttribute("href", "/en/contact");
  });

  it("reads the site settings for the visitor's locale", async () => {
    await renderPage("en", { whatsappNumber: NUMBER });

    expect(getSiteSettingsMock).toHaveBeenCalledWith("en");
  });

  it.each([
    ["no number is set", undefined],
    ["the number is not usable", "12345"],
  ])("hides the WhatsApp CTA when %s, keeping the contact link", async (_label, number) => {
    await renderPage("es", { whatsappNumber: number });

    expect(screen.queryByRole("link", { name: /WhatsApp/ })).not.toBeInTheDocument();
    expect(
      document.querySelector('a[href^="https://wa.me"]'),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Déjanos un mensaje" }),
    ).toHaveAttribute("href", "/es/contact");
  });

  it("still points back into the catalog", async () => {
    await renderPage("es", { whatsappNumber: NUMBER });

    expect(
      screen.getByRole("link", { name: esMessages.Checkout.successCta }),
    ).toHaveAttribute("href", "/es/shop");
  });
});
