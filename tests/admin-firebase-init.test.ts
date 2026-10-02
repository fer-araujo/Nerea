import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// firebase-admin is mocked wholesale: this file covers only OUR init rules —
// lazy, cached, fail-safe when unset, key normalization, and never leaking a
// credential. The module keeps state (the cached app), so each test loads a
// fresh copy via vi.resetModules() + a dynamic import.
vi.mock("server-only", () => ({}));

const certMock = vi.fn();
const initializeAppMock = vi.fn();
const getAppMock = vi.fn();
const getAppsMock = vi.fn();
const getAuthMock = vi.fn();
const getFirestoreMock = vi.fn();

vi.mock("firebase-admin/app", () => ({
  cert: (...args: unknown[]) => certMock(...args),
  initializeApp: (...args: unknown[]) => initializeAppMock(...args),
  getApp: (...args: unknown[]) => getAppMock(...args),
  getApps: (...args: unknown[]) => getAppsMock(...args),
}));
vi.mock("firebase-admin/auth", () => ({
  getAuth: (...args: unknown[]) => getAuthMock(...args),
}));
vi.mock("firebase-admin/firestore", () => ({
  getFirestore: (...args: unknown[]) => getFirestoreMock(...args),
}));

const FAKE_APP = { name: "[DEFAULT]" };
const SECRET_KEY_BODY = "super-secret-key-material";

async function loadModule() {
  vi.resetModules();
  return import("@/lib/admin/firebase/admin");
}

function setCredentials(privateKey = `-----BEGIN PRIVATE KEY-----\\n${SECRET_KEY_BODY}\\n-----END PRIVATE KEY-----\\n`) {
  vi.stubEnv("FIREBASE_PROJECT_ID", "nerea-test");
  vi.stubEnv("FIREBASE_CLIENT_EMAIL", "svc@nerea-test.iam.gserviceaccount.com");
  vi.stubEnv("FIREBASE_PRIVATE_KEY", privateKey);
}

beforeEach(() => {
  vi.resetAllMocks();
  getAppsMock.mockReturnValue([]);
  certMock.mockImplementation((value: unknown) => ({ credentialFor: value }));
  initializeAppMock.mockReturnValue(FAKE_APP);
  getAppMock.mockReturnValue(FAKE_APP);
  getAuthMock.mockReturnValue({ kind: "auth" });
  getFirestoreMock.mockReturnValue({ kind: "firestore" });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("firebase admin init", () => {
  it.each(["FIREBASE_PROJECT_ID", "FIREBASE_CLIENT_EMAIL", "FIREBASE_PRIVATE_KEY"])(
    "returns undefined for both getters, and initializes nothing, when %s is unset",
    async (missing) => {
      setCredentials();
      vi.stubEnv(missing, undefined);
      const { getAdminAuth, getAdminDb } = await loadModule();

      expect(getAdminAuth()).toBeUndefined();
      expect(getAdminDb()).toBeUndefined();
      expect(initializeAppMock).not.toHaveBeenCalled();
    },
  );

  it("does nothing at import time (lazy): no initialization until a getter is called", async () => {
    setCredentials();
    await loadModule();

    expect(initializeAppMock).not.toHaveBeenCalled();
    expect(certMock).not.toHaveBeenCalled();
  });

  it("turns literal \\n sequences in the private key back into real newlines", async () => {
    setCredentials(
      `-----BEGIN PRIVATE KEY-----\\n${SECRET_KEY_BODY}\\n-----END PRIVATE KEY-----\\n`,
    );
    const { getAdminAuth } = await loadModule();

    getAdminAuth();

    expect(certMock).toHaveBeenCalledWith({
      projectId: "nerea-test",
      clientEmail: "svc@nerea-test.iam.gserviceaccount.com",
      privateKey: `-----BEGIN PRIVATE KEY-----\n${SECRET_KEY_BODY}\n-----END PRIVATE KEY-----\n`,
    });
  });

  it("strips wrapping quotes pasted along with the key", async () => {
    setCredentials(`"-----BEGIN PRIVATE KEY-----\\n${SECRET_KEY_BODY}\\n-----END PRIVATE KEY-----\\n"`);
    const { getAdminAuth } = await loadModule();

    getAdminAuth();

    const { privateKey } = certMock.mock.calls[0][0];
    expect(privateKey.startsWith("-----BEGIN PRIVATE KEY-----\n")).toBe(true);
    expect(privateKey.endsWith("-----END PRIVATE KEY-----\n")).toBe(true);
  });

  it("initializes the app once and reuses it for Auth and Firestore", async () => {
    setCredentials();
    const { getAdminAuth, getAdminDb } = await loadModule();

    expect(getAdminAuth()).toEqual({ kind: "auth" });
    expect(getAdminDb()).toEqual({ kind: "firestore" });
    getAdminAuth();

    expect(initializeAppMock).toHaveBeenCalledTimes(1);
    expect(getAuthMock).toHaveBeenCalledWith(FAKE_APP);
    expect(getFirestoreMock).toHaveBeenCalledWith(FAKE_APP);
  });

  it("reuses an already-registered default app instead of initializing a second one (dev Fast Refresh)", async () => {
    setCredentials();
    getAppsMock.mockReturnValue([FAKE_APP]);
    const { getAdminAuth } = await loadModule();

    getAdminAuth();

    expect(initializeAppMock).not.toHaveBeenCalled();
    expect(getAppMock).toHaveBeenCalled();
  });

  it("fails safe, without throwing or leaking the key, when the credentials are unusable", async () => {
    setCredentials();
    certMock.mockImplementation(() => {
      throw new Error(`Failed to parse private key: ${SECRET_KEY_BODY}`);
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { getAdminAuth, getAdminDb } = await loadModule();

    expect(getAdminAuth()).toBeUndefined();
    expect(getAdminDb()).toBeUndefined();

    // One fixed-string hint, logged once, containing no credential material.
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged = errorSpy.mock.calls.flat().join(" ");
    expect(logged).not.toContain(SECRET_KEY_BODY);
    expect(logged).not.toContain("nerea-test");
    expect(logged).not.toContain("gserviceaccount");
  });
});
