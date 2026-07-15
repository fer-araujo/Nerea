import { afterEach, describe, expect, it, vi } from "vitest";
import { REQUEST_TIMEOUT_MS, shopifyFetch } from "../lib/shopify/client";

// shopifyFetch has a safety-critical contract: it must never throw an
// uncaught error, must never leak the Storefront access token, and must
// resolve to a typed { ok: false, error } result on every failure path
// (missing config, non-ok HTTP status, GraphQL errors[], network exceptions,
// and a hung request). This file pins that contract down.

const ORIGINAL_ENV = { ...process.env };
const TEST_DOMAIN = "test-shop.myshopify.com";
const TEST_TOKEN = "shpat_super-secret-token-value-do-not-leak";
const QUERY = "{ shop { name } }";

function setStorefrontEnv() {
  process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN = TEST_DOMAIN;
  process.env.SHOPIFY_STOREFRONT_API_TOKEN = TEST_TOKEN;
}

function clearStorefrontEnv() {
  delete process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN;
  delete process.env.SHOPIFY_STOREFRONT_API_TOKEN;
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("shopifyFetch — missing configuration", () => {
  it("returns { ok: false } instead of throwing when env vars are absent", async () => {
    clearStorefrontEnv();

    await expect(shopifyFetch({ query: QUERY })).resolves.toMatchObject({
      ok: false,
    });
  });

  it("returns { ok: false } when only the domain is set", async () => {
    clearStorefrontEnv();
    process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN = TEST_DOMAIN;

    await expect(shopifyFetch({ query: QUERY })).resolves.toMatchObject({
      ok: false,
    });
  });

  it("returns { ok: false } when only the token is set", async () => {
    clearStorefrontEnv();
    process.env.SHOPIFY_STOREFRONT_API_TOKEN = TEST_TOKEN;

    await expect(shopifyFetch({ query: QUERY })).resolves.toMatchObject({
      ok: false,
    });
  });
});

describe("shopifyFetch — HTTP and GraphQL failures", () => {
  it("returns { ok: false } when the HTTP response is not ok", async () => {
    setStorefrontEnv();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(null, { status: 500, statusText: "Internal Server Error" }),
        ),
    );

    const result = await shopifyFetch({ query: QUERY });

    expect(result.ok).toBe(false);
  });

  it("returns { ok: false } when the GraphQL response contains errors[]", async () => {
    setStorefrontEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            errors: [{ message: "Field 'name' doesn't exist on type 'Shop'" }],
          }),
          { status: 200 },
        ),
      ),
    );

    const result = await shopifyFetch({ query: QUERY });

    expect(result.ok).toBe(false);
  });

  it("catches a thrown/rejected fetch and returns { ok: false } instead of throwing", async () => {
    setStorefrontEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down")),
    );

    await expect(shopifyFetch({ query: QUERY })).resolves.toMatchObject({
      ok: false,
    });
  });
});

describe("shopifyFetch — timeout", () => {
  it("returns { ok: false } instead of hanging forever when the request stalls", async () => {
    setStorefrontEnv();
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const abortError = new Error("This operation was aborted");
            abortError.name = "AbortError";
            reject(abortError);
          });
        });
      }),
    );

    const pending = shopifyFetch({ query: QUERY });
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    const result = await pending;

    expect(result.ok).toBe(false);
  });
});

describe("shopifyFetch — token never leaks", () => {
  // These scenarios cover every path where shopifyFetch itself constructs the
  // error string (missing config, HTTP status, thrown/rejected fetch). A
  // GraphQL errors[] message is server-returned content the client is
  // expected to surface verbatim for debuggability, so it is intentionally
  // out of scope here — that path never has the token available to leak in
  // the first place, since shopifyFetch never interpolates config into it.
  it("never includes the access token when config is missing", async () => {
    clearStorefrontEnv();

    const result = await shopifyFetch({ query: QUERY });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).not.toContain(TEST_TOKEN);
    }
  });

  it("never includes the access token on a non-ok HTTP response", async () => {
    setStorefrontEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 401 })),
    );

    const result = await shopifyFetch({ query: QUERY });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).not.toContain(TEST_TOKEN);
    }
  });

  it("never includes the access token when the underlying fetch throws, even if the raw error message contains it", async () => {
    setStorefrontEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error(`request failed for token ${TEST_TOKEN}`)),
    );

    const result = await shopifyFetch({ query: QUERY });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).not.toContain(TEST_TOKEN);
    }
  });
});
