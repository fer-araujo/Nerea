import { beforeEach, describe, expect, it, vi } from "vitest";

// The mark-read action runs against the REAL data layer
// (lib/admin/data/contact-messages.ts) with Firestore faked at the very edge
// (getAdminDb), so "does not touch Firestore" is asserted where it matters —
// at the database boundary — not just at an intermediate function.
vi.mock("server-only", () => ({}));

const requireAdminMock = vi.fn();
vi.mock("@/lib/admin/auth/session", () => ({
  requireAdmin: (...args: unknown[]) => requireAdminMock(...args),
}));

const revalidatePathMock = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));

const updateMock = vi.fn();
const docMock = vi.fn(() => ({ update: updateMock }));
const collectionMock = vi.fn(() => ({ doc: docMock }));
const getAdminDbMock = vi.fn();
vi.mock("@/lib/admin/firebase/admin", () => ({
  getAdminDb: () => getAdminDbMock(),
}));

import { markMessageReadAction } from "@/app/admin/(panel)/mensajes/actions";

const FAILED = { ok: false, error: "failed" } as const;

function formWith(id?: unknown): FormData {
  const form = new FormData();
  if (id !== undefined) {
    form.set("id", id as string | Blob);
  }
  return form;
}

beforeEach(() => {
  vi.resetAllMocks();
  docMock.mockImplementation(() => ({ update: updateMock }));
  collectionMock.mockImplementation(() => ({ doc: docMock }));
  getAdminDbMock.mockReturnValue({ collection: collectionMock });
  requireAdminMock.mockResolvedValue({ uid: "uid-1", email: "admin@example.com" });
  updateMock.mockResolvedValue(undefined);
});

describe("markMessageReadAction", () => {
  it("authorizes with requireAdmin BEFORE touching Firestore", async () => {
    await markMessageReadAction(null, formWith("abc123"));

    expect(requireAdminMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(requireAdminMock.mock.invocationCallOrder[0]).toBeLessThan(
      getAdminDbMock.mock.invocationCallOrder[0],
    );
    expect(requireAdminMock.mock.invocationCallOrder[0]).toBeLessThan(
      updateMock.mock.invocationCallOrder[0],
    );
  });

  it("marks the message read, refreshes the list and returns ok", async () => {
    const result = await markMessageReadAction(null, formWith("abc123"));

    expect(result).toEqual({ ok: true });
    expect(collectionMock).toHaveBeenCalledWith("contactMessages");
    expect(docMock).toHaveBeenCalledWith("abc123");
    expect(updateMock).toHaveBeenCalledWith({ read: true });
    expect(revalidatePathMock).toHaveBeenCalledWith("/admin/mensajes");
  });

  it("ignores the previous state passed in by useActionState", async () => {
    const result = await markMessageReadAction(FAILED, formWith("abc123"));

    expect(result).toEqual({ ok: true });
  });

  it("never touches Firestore when the caller is not an admin (requireAdmin redirects)", async () => {
    requireAdminMock.mockRejectedValue(new Error("NEXT_REDIRECT /admin/login"));

    await expect(markMessageReadAction(null, formWith("abc123"))).rejects.toThrow(
      "NEXT_REDIRECT /admin/login",
    );

    expect(getAdminDbMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it.each([
    ["no id field", formWith()],
    ["a file instead of a string", formWith(new Blob(["x"]))],
    ["an empty id", formWith("")],
    ["an id that tries to address a nested path", formWith("abc/def/ghi")],
    ["an id with an overlong value", formWith("a".repeat(129))],
  ])("returns a failure and writes nothing for %s", async (_label, form) => {
    const result = await markMessageReadAction(null, form);

    expect(result).toEqual(FAILED);
    expect(updateMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("returns a failure, instead of swallowing it, when Firestore fails", async () => {
    updateMock.mockRejectedValue(new Error("5 NOT_FOUND"));

    const result = await markMessageReadAction(null, formWith("abc123"));

    expect(result).toEqual(FAILED);
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("does not leak the underlying error to the caller", async () => {
    updateMock.mockRejectedValue(new Error("secret internal detail"));

    const result = await markMessageReadAction(null, formWith("abc123"));

    expect(JSON.stringify(result)).not.toContain("secret internal detail");
  });

  it("returns a failure, not success, when Firebase is not configured", async () => {
    getAdminDbMock.mockReturnValue(undefined);

    const result = await markMessageReadAction(null, formWith("abc123"));

    expect(result).toEqual(FAILED);
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});
