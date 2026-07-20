import { afterEach, describe, expect, it, vi } from "vitest";

// Every collaborator is mocked so this file tests exactly submitContact's own
// branching (honeypot -> rate limit -> validation -> write), decoupled from
// the real Sanity write client, the process-local rate-limit Map, and Next's
// request-scoped headers() — matches the existing pattern in
// tests/cart-checkout-action.test.ts.
const isRateLimitedMock = vi.fn();
const getSanityWriteClientMock = vi.fn();
const createMock = vi.fn();

vi.mock("@/lib/contact/rate-limit", () => ({
  isRateLimited: (...args: unknown[]) => isRateLimitedMock(...args),
}));

vi.mock("@/lib/contact/write-client", () => ({
  getSanityWriteClient: () => getSanityWriteClientMock(),
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
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
});

describe("submitContact — honeypot", () => {
  it("returns success silently and never checks the rate limit or writes anything when the honeypot is filled", async () => {
    const result = await submitContact({ ...VALID_INPUT, honeypot: "I am a bot" });

    expect(result).toEqual({ ok: true });
    expect(isRateLimitedMock).not.toHaveBeenCalled();
    expect(getSanityWriteClientMock).not.toHaveBeenCalled();
  });
});

describe("submitContact — rate limit", () => {
  it("returns a rate_limit error and never validates or writes when the caller is limited", async () => {
    isRateLimitedMock.mockReturnValue(true);

    const result = await submitContact(VALID_INPUT);

    expect(result).toEqual({ ok: false, error: "rate_limit" });
    expect(getSanityWriteClientMock).not.toHaveBeenCalled();
  });
});

describe("submitContact — validation", () => {
  it("returns a validation error for a malformed submission without touching the write client", async () => {
    isRateLimitedMock.mockReturnValue(false);

    const result = await submitContact({ ...VALID_INPUT, email: "not-an-email" });

    expect(result).toEqual({ ok: false, error: "validation" });
    expect(getSanityWriteClientMock).not.toHaveBeenCalled();
  });
});

describe("submitContact — server misconfiguration", () => {
  it("returns a server error when no write client is available (e.g. SANITY_WRITE_TOKEN unset)", async () => {
    isRateLimitedMock.mockReturnValue(false);
    getSanityWriteClientMock.mockReturnValue(undefined);

    const result = await submitContact(VALID_INPUT);

    expect(result).toEqual({ ok: false, error: "server" });
  });
});

describe("submitContact — success", () => {
  it("creates a contactMessage document with trimmed fields and a server-generated createdAt", async () => {
    isRateLimitedMock.mockReturnValue(false);
    getSanityWriteClientMock.mockReturnValue({ create: createMock });
    createMock.mockResolvedValue({ _id: "abc123" });

    const before = Date.now();
    const result = await submitContact({
      ...VALID_INPUT,
      name: "  Ana  ",
      email: "  ana@example.com  ",
      message: "  Hola  ",
    });
    const after = Date.now();

    expect(result).toEqual({ ok: true });
    expect(createMock).toHaveBeenCalledTimes(1);

    const doc = createMock.mock.calls[0][0];
    expect(doc).toMatchObject({
      _type: "contactMessage",
      name: "Ana",
      email: "ana@example.com",
      message: "Hola",
    });
    const createdAt = new Date(doc.createdAt).getTime();
    expect(createdAt).toBeGreaterThanOrEqual(before);
    expect(createdAt).toBeLessThanOrEqual(after);
  });
});

describe("submitContact — write failure", () => {
  it("never throws and returns a server error when the Sanity write fails", async () => {
    isRateLimitedMock.mockReturnValue(false);
    getSanityWriteClientMock.mockReturnValue({ create: createMock });
    createMock.mockRejectedValue(new Error("network down"));

    await expect(submitContact(VALID_INPUT)).resolves.toEqual({
      ok: false,
      error: "server",
    });
  });
});
