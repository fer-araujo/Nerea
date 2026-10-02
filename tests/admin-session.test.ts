import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// firebase-admin and Next's request-scoped APIs are mocked so this file tests
// exactly the session module's own decisions (who gets a cookie, who gets
// through requireAdmin) — same lazy-mock style as tests/cart-checkout-action.test.ts.
// `server-only` throws outside a react-server build, so it is stubbed out.
vi.mock("server-only", () => ({}));

const cookieStore = {
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
};

vi.mock("next/headers", () => ({
  cookies: async () => cookieStore,
}));

// Like Next's real redirect(), the mock THROWS — code after it must not run.
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
}));

const verifyIdTokenMock = vi.fn();
const createSessionCookieMock = vi.fn();
const verifySessionCookieMock = vi.fn();
const revokeRefreshTokensMock = vi.fn();
let firebaseConfigured = true;

vi.mock("@/lib/admin/firebase/admin", () => ({
  getAdminAuth: () =>
    firebaseConfigured
      ? {
          verifyIdToken: (...args: unknown[]) => verifyIdTokenMock(...args),
          createSessionCookie: (...args: unknown[]) =>
            createSessionCookieMock(...args),
          verifySessionCookie: (...args: unknown[]) =>
            verifySessionCookieMock(...args),
          revokeRefreshTokens: (...args: unknown[]) =>
            revokeRefreshTokensMock(...args),
        }
      : undefined,
}));

import {
  SESSION_COOKIE_NAME,
  createAdminSession,
  getAdminOrNull,
  requireAdmin,
  signOutAdmin,
} from "@/lib/admin/auth/session";

const FIVE_DAYS_SECONDS = 5 * 24 * 60 * 60;
const nowSeconds = () => Math.floor(Date.now() / 1000);

function decodedToken(overrides: Record<string, unknown> = {}) {
  return {
    uid: "uid-1",
    email: "admin@example.com",
    email_verified: true,
    auth_time: nowSeconds() - 30,
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  firebaseConfigured = true;
  vi.stubEnv("ADMIN_EMAILS", "admin@example.com");
  cookieStore.get.mockReturnValue(undefined);
  verifyIdTokenMock.mockResolvedValue(decodedToken());
  createSessionCookieMock.mockResolvedValue("minted-session-cookie");
  verifySessionCookieMock.mockResolvedValue(decodedToken());
  revokeRefreshTokensMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("createAdminSession", () => {
  it("mints the session cookie for a verified, allowlisted, freshly signed-in admin", async () => {
    const result = await createAdminSession("id-token");

    expect(result).toEqual({ ok: true });
    // Revocation is checked while verifying the ID token.
    expect(verifyIdTokenMock).toHaveBeenCalledWith("id-token", true);
    expect(createSessionCookieMock).toHaveBeenCalledWith("id-token", {
      expiresIn: FIVE_DAYS_SECONDS * 1000,
    });

    expect(cookieStore.set).toHaveBeenCalledTimes(1);
    const [name, value, options] = cookieStore.set.mock.calls[0];
    expect(name).toBe(SESSION_COOKIE_NAME);
    expect(name).toBe("nerea_admin_session");
    expect(value).toBe("minted-session-cookie");
    expect(options).toMatchObject({
      httpOnly: true,
      sameSite: "strict",
      path: "/admin",
      maxAge: FIVE_DAYS_SECONDS,
    });
  });

  it("matches the allowlist case-insensitively and ignores whitespace around entries", async () => {
    vi.stubEnv("ADMIN_EMAILS", "  Other@Example.com ,  ADMIN@EXAMPLE.COM  ");
    verifyIdTokenMock.mockResolvedValue(
      decodedToken({ email: "Admin@Example.com" }),
    );

    await expect(createAdminSession("id-token")).resolves.toEqual({ ok: true });
  });

  it("marks the cookie Secure in production but not in development, so local http works", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await createAdminSession("id-token");
    expect(cookieStore.set.mock.calls[0][2]).toMatchObject({ secure: true });

    cookieStore.set.mockClear();
    vi.stubEnv("NODE_ENV", "development");
    await createAdminSession("id-token");
    expect(cookieStore.set.mock.calls[0][2]).toMatchObject({ secure: false });
  });

  it("rejects an unverified email and sets no cookie", async () => {
    verifyIdTokenMock.mockResolvedValue(decodedToken({ email_verified: false }));

    await expect(createAdminSession("id-token")).resolves.toEqual({
      ok: false,
      error: "unauthorized",
    });
    expect(createSessionCookieMock).not.toHaveBeenCalled();
    expect(cookieStore.set).not.toHaveBeenCalled();
  });

  it("rejects a token without an email claim", async () => {
    verifyIdTokenMock.mockResolvedValue(decodedToken({ email: undefined }));

    await expect(createAdminSession("id-token")).resolves.toEqual({
      ok: false,
      error: "unauthorized",
    });
    expect(cookieStore.set).not.toHaveBeenCalled();
  });

  it("rejects an email that is not on the allowlist", async () => {
    verifyIdTokenMock.mockResolvedValue(
      decodedToken({ email: "stranger@example.com" }),
    );

    await expect(createAdminSession("id-token")).resolves.toEqual({
      ok: false,
      error: "unauthorized",
    });
    expect(createSessionCookieMock).not.toHaveBeenCalled();
    expect(cookieStore.set).not.toHaveBeenCalled();
  });

  it("rejects a stale sign-in (auth_time older than 5 minutes)", async () => {
    verifyIdTokenMock.mockResolvedValue(
      decodedToken({ auth_time: nowSeconds() - 6 * 60 }),
    );

    await expect(createAdminSession("id-token")).resolves.toEqual({
      ok: false,
      error: "unauthorized",
    });
    expect(createSessionCookieMock).not.toHaveBeenCalled();
    expect(cookieStore.set).not.toHaveBeenCalled();
  });

  it("accepts a sign-in exactly 5 minutes old and rejects one second older", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-02T12:00:00Z"));
    const now = nowSeconds();

    verifyIdTokenMock.mockResolvedValue(decodedToken({ auth_time: now - 300 }));
    await expect(createAdminSession("id-token")).resolves.toEqual({ ok: true });

    verifyIdTokenMock.mockResolvedValue(decodedToken({ auth_time: now - 301 }));
    await expect(createAdminSession("id-token")).resolves.toEqual({
      ok: false,
      error: "unauthorized",
    });
  });

  it.each([
    ["unset", undefined],
    ["empty", ""],
    ["only commas and spaces", " , ,"],
  ])(
    "fails closed when ADMIN_EMAILS is %s, even for an otherwise valid token",
    async (_label, value) => {
      if (value === undefined) {
        vi.stubEnv("ADMIN_EMAILS", undefined);
      } else {
        vi.stubEnv("ADMIN_EMAILS", value);
      }

      await expect(createAdminSession("id-token")).resolves.toEqual({
        ok: false,
        error: "unauthorized",
      });
      expect(cookieStore.set).not.toHaveBeenCalled();
    },
  );

  it("rejects an invalid, expired or revoked ID token", async () => {
    verifyIdTokenMock.mockRejectedValue(new Error("auth/id-token-revoked"));

    await expect(createAdminSession("id-token")).resolves.toEqual({
      ok: false,
      error: "unauthorized",
    });
    expect(cookieStore.set).not.toHaveBeenCalled();
  });

  it("returns a server error when Firebase Admin is not configured", async () => {
    firebaseConfigured = false;

    await expect(createAdminSession("id-token")).resolves.toEqual({
      ok: false,
      error: "server",
    });
  });

  it("never throws: a failure while minting the cookie becomes a server error", async () => {
    createSessionCookieMock.mockRejectedValue(new Error("network down"));

    await expect(createAdminSession("id-token")).resolves.toEqual({
      ok: false,
      error: "server",
    });
    expect(cookieStore.set).not.toHaveBeenCalled();
  });
});

describe("requireAdmin / getAdminOrNull", () => {
  function withSessionCookie(value = "session-cookie") {
    cookieStore.get.mockReturnValue({ name: SESSION_COOKIE_NAME, value });
  }

  it("returns the admin for a valid session cookie, verifying it with the revocation check", async () => {
    withSessionCookie();

    await expect(requireAdmin()).resolves.toEqual({
      uid: "uid-1",
      email: "admin@example.com",
    });
    expect(cookieStore.get).toHaveBeenCalledWith(SESSION_COOKIE_NAME);
    expect(verifySessionCookieMock).toHaveBeenCalledWith("session-cookie", true);
  });

  it("redirects to the login page when there is no cookie, without calling Firebase", async () => {
    await expect(requireAdmin()).rejects.toThrow("NEXT_REDIRECT /admin/login");
    expect(verifySessionCookieMock).not.toHaveBeenCalled();
  });

  it("redirects when the cookie is invalid or expired", async () => {
    withSessionCookie();
    verifySessionCookieMock.mockRejectedValue(new Error("auth/argument-error"));

    await expect(requireAdmin()).rejects.toThrow("NEXT_REDIRECT /admin/login");
  });

  it("redirects when the session was revoked", async () => {
    withSessionCookie();
    verifySessionCookieMock.mockRejectedValue(
      new Error("auth/session-cookie-revoked"),
    );

    await expect(requireAdmin()).rejects.toThrow("NEXT_REDIRECT /admin/login");
    expect(verifySessionCookieMock).toHaveBeenCalledWith("session-cookie", true);
  });

  it("redirects when the email was removed from ADMIN_EMAILS after the cookie was issued", async () => {
    withSessionCookie();
    // Still a cryptographically valid cookie for admin@example.com...
    verifySessionCookieMock.mockResolvedValue(decodedToken());
    // ...but the allowlist no longer contains that address.
    vi.stubEnv("ADMIN_EMAILS", "someone-else@example.com");

    await expect(requireAdmin()).rejects.toThrow("NEXT_REDIRECT /admin/login");
  });

  it("redirects when the allowlist is empty", async () => {
    withSessionCookie();
    vi.stubEnv("ADMIN_EMAILS", "");

    await expect(requireAdmin()).rejects.toThrow("NEXT_REDIRECT /admin/login");
  });

  it("redirects when the session's email is not verified", async () => {
    withSessionCookie();
    verifySessionCookieMock.mockResolvedValue(
      decodedToken({ email_verified: false }),
    );

    await expect(requireAdmin()).rejects.toThrow("NEXT_REDIRECT /admin/login");
  });

  it("redirects when Firebase Admin is not configured", async () => {
    withSessionCookie();
    firebaseConfigured = false;

    await expect(requireAdmin()).rejects.toThrow("NEXT_REDIRECT /admin/login");
  });

  it("getAdminOrNull returns null instead of redirecting, for Route Handlers that answer 401", async () => {
    await expect(getAdminOrNull()).resolves.toBeNull();

    withSessionCookie();
    verifySessionCookieMock.mockRejectedValue(new Error("auth/argument-error"));
    await expect(getAdminOrNull()).resolves.toBeNull();

    verifySessionCookieMock.mockResolvedValue(decodedToken());
    await expect(getAdminOrNull()).resolves.toEqual({
      uid: "uid-1",
      email: "admin@example.com",
    });
  });
});

describe("signOutAdmin", () => {
  it("deletes the cookie on its original path and revokes the user's refresh tokens", async () => {
    cookieStore.get.mockReturnValue({ name: SESSION_COOKIE_NAME, value: "session-cookie" });

    await signOutAdmin();

    expect(cookieStore.delete).toHaveBeenCalledWith({
      name: SESSION_COOKIE_NAME,
      path: "/admin",
    });
    expect(verifySessionCookieMock).toHaveBeenCalledWith("session-cookie", false);
    expect(revokeRefreshTokensMock).toHaveBeenCalledWith("uid-1");
  });

  it("still deletes the cookie when there is none to revoke", async () => {
    await signOutAdmin();

    expect(cookieStore.delete).toHaveBeenCalledTimes(1);
    expect(revokeRefreshTokensMock).not.toHaveBeenCalled();
  });

  it("deletes the cookie and does not throw when the cookie is already invalid", async () => {
    cookieStore.get.mockReturnValue({ name: SESSION_COOKIE_NAME, value: "stale" });
    verifySessionCookieMock.mockRejectedValue(new Error("auth/argument-error"));

    await expect(signOutAdmin()).resolves.toBeUndefined();
    expect(cookieStore.delete).toHaveBeenCalledTimes(1);
    expect(revokeRefreshTokensMock).not.toHaveBeenCalled();
  });

  it("never throws, and the cookie is gone, when revoking fails", async () => {
    cookieStore.get.mockReturnValue({ name: SESSION_COOKIE_NAME, value: "session-cookie" });
    revokeRefreshTokensMock.mockRejectedValue(new Error("network down"));

    await expect(signOutAdmin()).resolves.toBeUndefined();
    expect(cookieStore.delete).toHaveBeenCalledTimes(1);
  });
});
