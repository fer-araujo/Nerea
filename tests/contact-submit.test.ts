import { afterEach, describe, expect, it, vi } from "vitest";

// Every collaborator is mocked so this file tests exactly submitContact's own
// branching (honeypot -> rate limit -> validation -> write), decoupled from
// Firestore, the process-local rate-limit Map, and Next's request-scoped
// headers() — matches the existing pattern in
// tests/cart-checkout-action.test.ts. The Firestore write itself is covered
// in tests/contact-messages-data.test.ts.
const isRateLimitedMock = vi.fn();
const saveContactMessageMock = vi.fn();

// The headers of the "incoming request"; tests replace it via requestWith().
let requestHeaders = new Headers();

function requestWith(init: Record<string, string>) {
  requestHeaders = new Headers(init);
}

vi.mock("@/lib/contact/rate-limit", () => ({
  isRateLimited: (...args: unknown[]) => isRateLimitedMock(...args),
}));

vi.mock("@/lib/admin/data/contact-messages", () => ({
  saveContactMessage: (...args: unknown[]) => saveContactMessageMock(...args),
}));

vi.mock("next/headers", () => ({
  headers: async () => requestHeaders,
}));

import { submitContact } from "@/lib/contact/submit";

const VALID_INPUT = {
  name: "Ana",
  email: "ana@example.com",
  message: "Me interesa una pieza.",
  honeypot: "",
};

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  requestHeaders = new Headers();
});

describe("submitContact — honeypot", () => {
  it("returns success silently and never checks the rate limit or writes anything when the honeypot is filled", async () => {
    const result = await submitContact({ ...VALID_INPUT, honeypot: "I am a bot" });

    expect(result).toEqual({ ok: true });
    expect(isRateLimitedMock).not.toHaveBeenCalled();
    expect(saveContactMessageMock).not.toHaveBeenCalled();
  });
});

describe("submitContact — rate limit", () => {
  it("returns a rate_limit error and never validates or writes when the caller is limited", async () => {
    isRateLimitedMock.mockReturnValue(true);

    const result = await submitContact(VALID_INPUT);

    expect(result).toEqual({ ok: false, error: "rate_limit" });
    expect(saveContactMessageMock).not.toHaveBeenCalled();
  });
});

// Which request header may be trusted as the client IP depends on the hosting
// platform, resolved at BUILD time into DEPLOY_PLATFORM (next.config.ts). The
// bucket key is whatever isRateLimited() receives.
describe("submitContact — rate-limit key (client IP)", () => {
  async function bucketKeyFor(headers: Record<string, string>) {
    isRateLimitedMock.mockReturnValue(false);
    saveContactMessageMock.mockResolvedValue(true);
    requestWith(headers);

    await submitContact(VALID_INPUT);

    expect(isRateLimitedMock).toHaveBeenCalledTimes(1);
    return isRateLimitedMock.mock.calls[0][0];
  }

  it("reads x-nf-client-connection-ip on Netlify", async () => {
    vi.stubEnv("DEPLOY_PLATFORM", "netlify");

    await expect(
      bucketKeyFor({ "x-nf-client-connection-ip": "203.0.113.7" }),
    ).resolves.toBe("203.0.113.7");
  });

  it("reads x-real-ip on Vercel", async () => {
    vi.stubEnv("DEPLOY_PLATFORM", "vercel");

    await expect(bucketKeyFor({ "x-real-ip": "198.51.100.4" })).resolves.toBe(
      "198.51.100.4",
    );
  });

  it("trims the trusted header value", async () => {
    vi.stubEnv("DEPLOY_PLATFORM", "netlify");

    await expect(
      bucketKeyFor({ "x-nf-client-connection-ip": "  203.0.113.7  " }),
    ).resolves.toBe("203.0.113.7");
  });

  it("ignores a forged x-real-ip on Netlify (the platform's own header wins)", async () => {
    vi.stubEnv("DEPLOY_PLATFORM", "netlify");

    await expect(
      bucketKeyFor({
        "x-nf-client-connection-ip": "203.0.113.7",
        "x-real-ip": "6.6.6.6",
      }),
    ).resolves.toBe("203.0.113.7");
  });

  it("does not let a forged x-real-ip choose the bucket on Netlify when the platform header is missing", async () => {
    vi.stubEnv("DEPLOY_PLATFORM", "netlify");

    await expect(bucketKeyFor({ "x-real-ip": "6.6.6.6" })).resolves.toBe("unknown");
  });

  it("ignores a forged x-nf-client-connection-ip on Vercel (the platform's own header wins)", async () => {
    vi.stubEnv("DEPLOY_PLATFORM", "vercel");

    await expect(
      bucketKeyFor({
        "x-real-ip": "198.51.100.4",
        "x-nf-client-connection-ip": "6.6.6.6",
      }),
    ).resolves.toBe("198.51.100.4");
  });

  it("does not let a forged x-nf-client-connection-ip choose the bucket on Vercel when the platform header is missing", async () => {
    vi.stubEnv("DEPLOY_PLATFORM", "vercel");

    await expect(
      bucketKeyFor({ "x-nf-client-connection-ip": "6.6.6.6" }),
    ).resolves.toBe("unknown");
  });

  it.each([
    ["unset", undefined],
    ["empty (unknown host / local dev)", ""],
    ["an unrecognized value", "heroku"],
  ])(
    "uses the shared bucket when the platform is %s, whatever headers are sent",
    async (_label, platform) => {
      vi.stubEnv("DEPLOY_PLATFORM", platform);

      await expect(
        bucketKeyFor({
          "x-real-ip": "6.6.6.6",
          "x-nf-client-connection-ip": "7.7.7.7",
        }),
      ).resolves.toBe("unknown");
    },
  );

  it.each(["netlify", "vercel", ""])(
    "never reads x-forwarded-for (platform %j)",
    async (platform) => {
      vi.stubEnv("DEPLOY_PLATFORM", platform);

      await expect(
        bucketKeyFor({ "x-forwarded-for": "5.5.5.5, 8.8.8.8" }),
      ).resolves.toBe("unknown");
    },
  );

  it("falls back to the shared bucket when the trusted header is empty", async () => {
    vi.stubEnv("DEPLOY_PLATFORM", "netlify");

    await expect(
      bucketKeyFor({ "x-nf-client-connection-ip": "   " }),
    ).resolves.toBe("unknown");
  });
});

describe("submitContact — validation", () => {
  it("returns a validation error for a malformed submission without writing", async () => {
    isRateLimitedMock.mockReturnValue(false);

    const result = await submitContact({ ...VALID_INPUT, email: "not-an-email" });

    expect(result).toEqual({ ok: false, error: "validation" });
    expect(saveContactMessageMock).not.toHaveBeenCalled();
  });
});

describe("submitContact — server misconfiguration", () => {
  it("returns a server error, not success, when Firebase is not configured (nothing was stored)", async () => {
    isRateLimitedMock.mockReturnValue(false);
    saveContactMessageMock.mockResolvedValue(false);

    const result = await submitContact(VALID_INPUT);

    expect(result).toEqual({ ok: false, error: "server" });
  });
});

describe("submitContact — success", () => {
  it("writes the trimmed fields through saveContactMessage and nothing else", async () => {
    isRateLimitedMock.mockReturnValue(false);
    saveContactMessageMock.mockResolvedValue(true);

    const result = await submitContact({
      ...VALID_INPUT,
      name: "  Ana  ",
      email: "  ana@example.com  ",
      message: "  Hola  ",
    });

    expect(result).toEqual({ ok: true });
    expect(saveContactMessageMock).toHaveBeenCalledTimes(1);
    // Exactly the validated fields: the honeypot (or any client-supplied
    // extra) never reaches storage, and neither does a client timestamp —
    // saveContactMessage stamps the time itself.
    expect(saveContactMessageMock).toHaveBeenCalledWith({
      name: "Ana",
      email: "ana@example.com",
      message: "Hola",
    });
  });

  it("runs the guards in order: rate limit before the write", async () => {
    isRateLimitedMock.mockReturnValue(false);
    saveContactMessageMock.mockResolvedValue(true);

    await submitContact(VALID_INPUT);

    expect(isRateLimitedMock.mock.invocationCallOrder[0]).toBeLessThan(
      saveContactMessageMock.mock.invocationCallOrder[0],
    );
  });
});

describe("submitContact — write failure", () => {
  it("never throws and returns a server error when the Firestore write fails", async () => {
    isRateLimitedMock.mockReturnValue(false);
    saveContactMessageMock.mockRejectedValue(new Error("network down"));

    await expect(submitContact(VALID_INPUT)).resolves.toEqual({
      ok: false,
      error: "server",
    });
  });
});
