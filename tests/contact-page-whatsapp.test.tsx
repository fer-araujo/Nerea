// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import enMessages from "../messages/en.json";
import esMessages from "../messages/es.json";
import type { SiteSettings } from "../lib/site-settings/types";

type Locale = "es" | "en";

const MESSAGES = { es: esMessages, en: enMessages };

// Same server-component rendering approach as tests/shop-catalog.test.tsx and
// tests/checkout-success-page.test.tsx: `next-intl/server` is mocked on top of
// the real message files.
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

const getSiteSettingsMock = vi.fn();
vi.mock("@/lib/site-settings/adapter", () => ({
  getSiteSettings: (...args: unknown[]) => getSiteSettingsMock(...args),
}));

// The form is a client island with its own tests; a stub keeps this file on
// what the page itself adds.
vi.mock("@/components/contact/ContactForm", () => ({
  ContactForm: () => <form aria-label="contact-form-stub" />,
}));

import ContactPage from "../app/[locale]/contact/page";

const NUMBER = "5215512345678";

async function renderPage(locale: Locale, settings: Partial<SiteSettings> = {}) {
  getSiteSettingsMock.mockResolvedValue({
    logo: null,
    hero: null,
    heroAlt: null,
    ...settings,
  });
  render(await ContactPage({ params: Promise.resolve({ locale }) }));
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("contact page — WhatsApp link", () => {
  it("shows the WhatsApp link, ahead of the form, when the number is set", async () => {
    await renderPage("es", { whatsappNumber: NUMBER });

    const whatsapp = screen.getByRole("link", { name: "Escríbenos por WhatsApp" });
    expect(whatsapp).toHaveAttribute(
      "href",
      `https://wa.me/${NUMBER}?text=${encodeURIComponent(esMessages.Contact.whatsappText)}`,
    );
    expect(whatsapp).toHaveAttribute("target", "_blank");
    expect(whatsapp).toHaveAttribute("rel", "noopener noreferrer");

    const form = screen.getByRole("form", { name: "contact-form-stub" });
    expect(
      whatsapp.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("localizes the link in English", async () => {
    await renderPage("en", { whatsappNumber: NUMBER });

    expect(
      screen.getByRole("link", { name: "Message us on WhatsApp" }),
    ).toHaveAttribute(
      "href",
      `https://wa.me/${NUMBER}?text=${encodeURIComponent(enMessages.Contact.whatsappText)}`,
    );
  });

  it.each([
    ["no number is set", undefined],
    ["the number is not usable", "abc"],
  ])("shows no WhatsApp link when %s, and the form still renders", async (_label, number) => {
    await renderPage("es", { whatsappNumber: number });

    expect(screen.queryByRole("link", { name: /WhatsApp/ })).not.toBeInTheDocument();
    expect(
      screen.getByRole("form", { name: "contact-form-stub" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: esMessages.Contact.title }),
    ).toBeInTheDocument();
  });
});
