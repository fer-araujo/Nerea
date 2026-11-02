import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// parseBody (next-sanity) and next/cache are the two edges: the signature check
// is the library's concern, and the real revalidateTag needs a live Next
// request context. What is pinned here is this route's own contract: it fails
// closed, and it maps a changed document type to the tags it expires.
const parseBodyMock = vi.fn();
vi.mock("next-sanity/webhook", () => ({
  parseBody: (...args: unknown[]) => parseBodyMock(...args),
}));

const revalidateTagMock = vi.fn();
vi.mock("next/cache", () => ({
  revalidateTag: (...args: unknown[]) => revalidateTagMock(...args),
}));

import * as route from "@/app/api/revalidate/route";
import { CATEGORIES_TAG, PRODUCTS_TAG } from "@/lib/commerce/sanity/client";
import { SITE_SETTINGS_TAG } from "@/lib/site-settings/adapter";

const { POST } = route;

const ORIGINAL_ENV = { ...process.env };
const SECRET = "whsec_sanity_test";

function makeRequest(): NextRequest {
  return new Request("https://nerea.example/api/revalidate", {
    method: "POST",
    headers: { "sanity-webhook-signature": "t=1,v1=abc" },
    body: JSON.stringify({ _type: "product" }),
  }) as NextRequest;
}

function validDelivery(body: unknown) {
  parseBodyMock.mockResolvedValue({ isValidSignature: true, body });
}

beforeEach(() => {
  process.env.SANITY_REVALIDATE_SECRET = SECRET;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

describe("POST /api/revalidate — fails closed", () => {
  it.each([
    ["unset", undefined],
    ["empty", ""],
    ["whitespace only", "   "],
  ])(
    "answers 401 and verifies nothing when the secret is %s",
    async (_label, value) => {
      if (value === undefined) {
        delete process.env.SANITY_REVALIDATE_SECRET;
      } else {
        process.env.SANITY_REVALIDATE_SECRET = value;
      }
      // Even a delivery that parseBody would call "valid" must not get through:
      // without a secret parseBody does not verify anything (it answers null).
      validDelivery({ _type: "product" });

      const response = await POST(makeRequest());

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "invalid signature" });
      expect(parseBodyMock).not.toHaveBeenCalled();
      expect(revalidateTagMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["wrong", false],
    ["absent (no signature header)", null],
  ])("answers 401 and revalidates nothing when the signature is %s", async (_label, verdict) => {
    parseBodyMock.mockResolvedValue({
      isValidSignature: verdict,
      body: { _type: "product" },
    });

    const response = await POST(makeRequest());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "invalid signature" });
    expect(revalidateTagMock).not.toHaveBeenCalled();
  });

  it("answers 401 (not a 500) when parseBody throws, e.g. on a body that is not JSON", async () => {
    parseBodyMock.mockRejectedValue(new SyntaxError("Unexpected token"));

    const response = await POST(makeRequest());

    expect(response.status).toBe(401);
    expect(revalidateTagMock).not.toHaveBeenCalled();
  });

  it("only treats an explicit true as a valid signature", async () => {
    parseBodyMock.mockResolvedValue({ isValidSignature: "yes", body: { _type: "product" } });

    const response = await POST(makeRequest());

    expect(response.status).toBe(401);
    expect(revalidateTagMock).not.toHaveBeenCalled();
  });

  it("verifies the request against the configured secret", async () => {
    validDelivery({ _type: "product" });
    const request = makeRequest();

    await POST(request);

    expect(parseBodyMock).toHaveBeenCalledTimes(1);
    expect(parseBodyMock.mock.calls[0][0]).toBe(request);
    expect(parseBodyMock.mock.calls[0][1]).toBe(SECRET);
  });

  it("exposes POST only", () => {
    expect(route.POST).toBeTypeOf("function");
    expect(route).not.toHaveProperty("GET");
  });
});

describe("POST /api/revalidate — a verified delivery", () => {
  it.each([
    ["product", ["products"]],
    ["category", ["categories", "products"]],
    // The settings also carry the default ring sizes / chain lengths that the
    // product query projects, hence the catalog tag too.
    ["siteSettings", ["site-settings", "products"]],
  ])("expires the right tags for a changed %s, immediately", async (type, tags) => {
    validDelivery({ _type: type });

    const response = await POST(makeRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ revalidated: tags });
    // { expire: 0 }: Route Handlers cannot use updateTag, and "max" would keep
    // serving the stale page while it refreshes.
    expect(revalidateTagMock.mock.calls).toEqual(tags.map((tag) => [tag, { expire: 0 }]));
  });

  it("uses the very tags the adapters read with", async () => {
    validDelivery({ _type: "category" });
    await POST(makeRequest());
    expect(revalidateTagMock.mock.calls.map(([tag]) => tag)).toEqual([
      CATEGORIES_TAG,
      PRODUCTS_TAG,
    ]);

    revalidateTagMock.mockClear();
    validDelivery({ _type: "siteSettings" });
    await POST(makeRequest());
    expect(revalidateTagMock.mock.calls.map(([tag]) => tag)).toEqual([
      SITE_SETTINGS_TAG,
      PRODUCTS_TAG,
    ]);
  });

  it.each([
    ["an unknown type", { _type: "somethingElse" }],
    ["a missing type", {}],
    ["a type that is not a string", { _type: 42 }],
    ["an empty body", null],
  ])("falls back to the catalog tag for %s: over-purging is cheap, a stale shop is not", async (_label, body) => {
    validDelivery(body);

    const response = await POST(makeRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ revalidated: ["products"] });
    expect(revalidateTagMock).toHaveBeenCalledTimes(1);
    expect(revalidateTagMock).toHaveBeenCalledWith("products", { expire: 0 });
  });

  it("never logs the body, the secret or the signature", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    validDelivery({ _type: "product", title: "Anillo Luna" });

    await POST(makeRequest());
    parseBodyMock.mockResolvedValue({ isValidSignature: false, body: { _type: "product" } });
    await POST(makeRequest());

    for (const spy of [log, info, warn, error]) {
      expect(spy).not.toHaveBeenCalled();
    }
  });
});
