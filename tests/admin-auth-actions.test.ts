import { beforeEach, describe, expect, it, vi } from "vitest";

// Both auth actions delegate to lib/admin/auth/session; that module is mocked
// here so these tests cover only what the ACTIONS add: input validation for
// login, and "authorize first, then sign out, then redirect" for logout. The
// session module's own behavior is in tests/admin-session.test.ts.
vi.mock("server-only", () => ({}));

const createAdminSessionMock = vi.fn();
const requireAdminMock = vi.fn();
const signOutAdminMock = vi.fn();
vi.mock("@/lib/admin/auth/session", () => ({
  createAdminSession: (...args: unknown[]) => createAdminSessionMock(...args),
  requireAdmin: (...args: unknown[]) => requireAdminMock(...args),
  signOutAdmin: (...args: unknown[]) => signOutAdminMock(...args),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
}));

import { loginAction } from "@/app/admin/login/actions";
import { logoutAction } from "@/app/admin/(panel)/actions";

beforeEach(() => {
  vi.resetAllMocks();
  createAdminSessionMock.mockResolvedValue({ ok: true });
  requireAdminMock.mockResolvedValue({ uid: "uid-1", email: "admin@example.com" });
  signOutAdminMock.mockResolvedValue(undefined);
});

describe("loginAction", () => {
  it("hands a well-formed token to createAdminSession and returns its result", async () => {
    await expect(loginAction("a.b.c")).resolves.toEqual({ ok: true });
    expect(createAdminSessionMock).toHaveBeenCalledWith("a.b.c");

    createAdminSessionMock.mockResolvedValue({ ok: false, error: "unauthorized" });
    await expect(loginAction("a.b.c")).resolves.toEqual({
      ok: false,
      error: "unauthorized",
    });
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a number", 42],
    ["an object", { token: "a.b.c" }],
    ["an array", ["a.b.c"]],
    ["an empty string", ""],
    ["an oversized string", "x".repeat(4097)],
  ])("rejects %s without involving Firebase", async (_label, input) => {
    await expect(loginAction(input)).resolves.toEqual({
      ok: false,
      error: "unauthorized",
    });
    expect(createAdminSessionMock).not.toHaveBeenCalled();
  });

  it("accepts a token right at the length bound", async () => {
    await loginAction("x".repeat(4096));
    expect(createAdminSessionMock).toHaveBeenCalledTimes(1);
  });
});

describe("logoutAction", () => {
  it("authorizes first, then signs out, then redirects to the login page", async () => {
    await expect(logoutAction()).rejects.toThrow("NEXT_REDIRECT /admin/login");

    expect(requireAdminMock).toHaveBeenCalledTimes(1);
    expect(signOutAdminMock).toHaveBeenCalledTimes(1);
    expect(requireAdminMock.mock.invocationCallOrder[0]).toBeLessThan(
      signOutAdminMock.mock.invocationCallOrder[0],
    );
  });

  it("does nothing when the caller has no valid session (requireAdmin redirects)", async () => {
    requireAdminMock.mockRejectedValue(new Error("NEXT_REDIRECT /admin/login"));

    await expect(logoutAction()).rejects.toThrow("NEXT_REDIRECT /admin/login");
    expect(signOutAdminMock).not.toHaveBeenCalled();
  });
});
