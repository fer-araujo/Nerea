import { describe, expect, it } from "vitest";
import robots from "../app/robots";

// robots.txt is only a courtesy to well-behaved crawlers (the panel itself is
// protected by requireAdmin() and noindex metadata), but a regression here
// would invite search engines to crawl the login page and Studio.
function disallowedPaths(): string[] {
  const { rules } = robots();
  const rule = Array.isArray(rules) ? rules[0] : rules;
  const disallow = rule.disallow;
  return Array.isArray(disallow) ? disallow : disallow ? [disallow] : [];
}

describe("robots", () => {
  it("disallows the admin panel and the embedded Studio", () => {
    const disallowed = disallowedPaths();

    expect(disallowed).toContain("/admin");
    expect(disallowed).toContain("/studio");
  });

  it("keeps the existing rules: checkout is disallowed per locale and the rest stays crawlable", () => {
    const { rules } = robots();
    const rule = Array.isArray(rules) ? rules[0] : rules;

    expect(disallowedPaths()).toEqual(
      expect.arrayContaining(["/es/checkout", "/en/checkout"]),
    );
    expect(rule.userAgent).toBe("*");
    expect(rule.allow).toBe("/");
  });

  it("still advertises the sitemap", () => {
    expect(robots().sitemap).toMatch(/\/sitemap\.xml$/);
  });
});
