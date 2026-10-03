import { beforeEach, describe, expect, it, vi } from "vitest";

// Only the network client is replaced; the real query, adapter and number
// normalizer run.
const fetchMock = vi.fn();

vi.mock("@/lib/commerce/sanity/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/commerce/sanity/client")>()),
  sanityClient: { fetch: (...args: unknown[]) => fetchMock(...args) },
}));

import { getSiteSettings } from "@/lib/site-settings/adapter";
import { SITE_SETTINGS_QUERY } from "@/lib/site-settings/queries";

function rawSettings(overrides: Record<string, unknown> = {}) {
  return {
    logo: null,
    hero: null,
    heroAlt: null,
    whatsappNumber: "5215512345678",
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("getSiteSettings — WhatsApp number", () => {
  it("asks Sanity for it, with the locale as a parameter", async () => {
    fetchMock.mockResolvedValue(rawSettings());

    await getSiteSettings("es");

    const [query, params] = fetchMock.mock.calls[0];
    expect(query).toBe(SITE_SETTINGS_QUERY);
    expect(query).toContain("whatsappNumber");
    expect(params).toEqual({ locale: "es" });
  });

  it("exposes a stored number as digits only", async () => {
    fetchMock.mockResolvedValue(
      rawSettings({ whatsappNumber: " +52 1 55 1234 5678 " }),
    );

    expect((await getSiteSettings("es")).whatsappNumber).toBe("5215512345678");
  });

  it.each([
    ["missing", undefined],
    ["null", null],
    ["empty", ""],
    ["text", "no tengo"],
    ["too short", "12345"],
    ["too long", "1234567890123456"],
  ])("leaves it undefined when the stored value is %s", async (_label, value) => {
    fetchMock.mockResolvedValue(rawSettings({ whatsappNumber: value }));

    expect((await getSiteSettings("es")).whatsappNumber).toBeUndefined();
  });

  it("keeps the rest of the settings as they were", async () => {
    fetchMock.mockResolvedValue(
      rawSettings({
        logo: { kind: "image", url: "https://cdn.sanity.io/logo.png" },
        heroAlt: "Taller",
      }),
    );

    expect(await getSiteSettings("es")).toEqual({
      logo: { kind: "image", url: "https://cdn.sanity.io/logo.png" },
      hero: null,
      heroAlt: "Taller",
      whatsappNumber: "5215512345678",
    });
  });

  it("has no number when the settings document does not exist yet", async () => {
    fetchMock.mockResolvedValue(null);

    expect((await getSiteSettings("es")).whatsappNumber).toBeUndefined();
  });

  it("has no number, and does not throw, when Sanity fails", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));

    expect((await getSiteSettings("es")).whatsappNumber).toBeUndefined();
  });
});
