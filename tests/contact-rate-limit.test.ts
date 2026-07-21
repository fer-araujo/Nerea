import { describe, expect, it } from "vitest";
import { isRateLimited } from "@/lib/contact/rate-limit";

// Each test uses its own unique key so the module-level `hits` Map
// (intentionally a shared, process-local singleton — see rate-limit.ts)
// never leaks state across assertions in this file.
let keyCounter = 0;
function uniqueKey(): string {
  keyCounter += 1;
  return `test-key-${keyCounter}`;
}

describe("isRateLimited", () => {
  it("allows the first request for a fresh key", () => {
    expect(isRateLimited(uniqueKey())).toBe(false);
  });

  it("allows up to 5 requests inside the same window, then blocks the 6th", () => {
    const key = uniqueKey();
    const now = 1_000_000;

    for (let i = 0; i < 5; i += 1) {
      expect(isRateLimited(key, now)).toBe(false);
    }
    expect(isRateLimited(key, now)).toBe(true);
  });

  it("keeps blocking further requests within the same window", () => {
    const key = uniqueKey();
    const now = 1_500_000;

    for (let i = 0; i < 6; i += 1) {
      isRateLimited(key, now);
    }
    expect(isRateLimited(key, now)).toBe(true);
    expect(isRateLimited(key, now + 1)).toBe(true);
  });

  it("resets once the fixed window has elapsed", () => {
    const key = uniqueKey();
    const windowStart = 2_000_000;

    for (let i = 0; i < 6; i += 1) {
      isRateLimited(key, windowStart);
    }
    expect(isRateLimited(key, windowStart)).toBe(true);

    // The window is 60_000ms — one tick past it must reset the counter.
    expect(isRateLimited(key, windowStart + 60_000)).toBe(false);
  });

  it("tracks different keys independently", () => {
    const keyA = uniqueKey();
    const keyB = uniqueKey();
    const now = 3_000_000;

    for (let i = 0; i < 5; i += 1) {
      isRateLimited(keyA, now);
    }
    expect(isRateLimited(keyA, now)).toBe(true);
    expect(isRateLimited(keyB, now)).toBe(false);
  });
});
