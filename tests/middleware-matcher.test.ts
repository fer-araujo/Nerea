import { describe, expect, it } from "vitest";
import { MIDDLEWARE_MATCHER } from "../middleware";

// `config.matcher` is enforced by Next.js's routing layer before middleware()
// is ever invoked, so calling middleware() directly in a test cannot verify
// the matcher itself — see tests/locale-routing.test.ts for behavior of the
// middleware function body instead. This test checks the matcher pattern in
// isolation, confirming it excludes API routes, Next internals, the embedded
// Sanity Studio, and file-like paths while matching normal app routes.
const matcherRegex = new RegExp(`^${MIDDLEWARE_MATCHER}$`);

describe("middleware matcher pattern", () => {
  it.each([
    "/api/foo",
    "/api",
    "/_next/static/a.js",
    "/_vercel/insights",
    "/favicon.ico",
    "/studio",
    "/studio/desk/product",
  ])("excludes %s", (pathname) => {
    expect(matcherRegex.test(pathname)).toBe(false);
  });

  it.each(["/", "/en", "/shop", "/es/products/ring"])("matches %s", (pathname) => {
    expect(matcherRegex.test(pathname)).toBe(true);
  });
});
