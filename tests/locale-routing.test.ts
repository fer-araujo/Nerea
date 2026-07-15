import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import middleware from "../middleware";

function request(pathname: string) {
  return new NextRequest(new URL(pathname, "https://nerea.test"));
}

describe("locale routing middleware", () => {
  it("resolves the root path to the default /es locale", () => {
    const response = middleware(request("/"));

    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location")!).pathname).toBe("/es");
  });

  it("lets the /en locale through without redirecting elsewhere", () => {
    const response = middleware(request("/en"));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("treats an unsupported locale prefix as a path segment under the default locale", () => {
    // next-intl does not recognize "/fr" as a supported locale, so it
    // redirects to the default locale ("es") with "/fr" preserved as a path
    // segment, rather than 404ing or stripping it.
    const response = middleware(request("/fr"));

    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location")!).pathname).toBe("/es/fr");
  });
});
