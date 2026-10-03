import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// getSanityWriteClient is mocked entirely so this file tests exactly
// markProductsSold's own handle -> id -> patch orchestration, decoupled
// from the real @sanity/client SDK — matches the existing pattern in
// tests/contact-submit.test.ts.
const getSanityWriteClientMock = vi.fn();
const fetchMock = vi.fn();
const setMock = vi.fn();
const commitMock = vi.fn();
const patchMock = vi.fn();

vi.mock("@/lib/sanity/write-client", () => ({
  getSanityWriteClient: () => getSanityWriteClientMock(),
}));

import { markProductsSold } from "@/lib/commerce/sanity/mark-sold";

beforeEach(() => {
  setMock.mockReturnValue({ commit: commitMock });
  patchMock.mockReturnValue({ set: setMock });
  getSanityWriteClientMock.mockReturnValue({
    fetch: fetchMock,
    patch: patchMock,
  });
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("markProductsSold", () => {
  it("resolves a handle to its Sanity _id via a parameterized query, then patches status to sold", async () => {
    fetchMock.mockResolvedValueOnce({ _id: "product-123" });
    commitMock.mockResolvedValueOnce({});

    const result = await markProductsSold(["anillo-plata"]);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("$handle"),
      { handle: "anillo-plata" },
    );
    expect(patchMock).toHaveBeenCalledWith("product-123");
    expect(setMock).toHaveBeenCalledWith({ status: "sold" });
    expect(commitMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ marked: ["anillo-plata"], missing: [], failed: [] });
  });

  it("processes every handle in the batch independently", async () => {
    fetchMock
      .mockResolvedValueOnce({ _id: "id-1" })
      .mockResolvedValueOnce({ _id: "id-2" });
    commitMock.mockResolvedValue({});

    const result = await markProductsSold(["anillo-plata", "aretes-luna"]);

    expect(patchMock).toHaveBeenCalledWith("id-1");
    expect(patchMock).toHaveBeenCalledWith("id-2");
    expect(commitMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      marked: ["anillo-plata", "aretes-luna"],
      missing: [],
      failed: [],
    });
  });

  it("reports a handle with no matching document as MISSING — not an error — and still processes the rest", async () => {
    fetchMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ _id: "id-2" });
    commitMock.mockResolvedValue({});

    const result = await markProductsSold(["unknown-handle", "aretes-luna"]);

    expect(patchMock).toHaveBeenCalledTimes(1);
    expect(patchMock).toHaveBeenCalledWith("id-2");
    expect(result).toEqual({
      marked: ["aretes-luna"],
      missing: ["unknown-handle"],
      failed: [],
    });
  });

  it("treats a document that came back without an _id as missing too", async () => {
    fetchMock.mockResolvedValueOnce({});

    const result = await markProductsSold(["raro"]);

    expect(patchMock).not.toHaveBeenCalled();
    expect(result).toEqual({ marked: [], missing: ["raro"], failed: [] });
  });

  it("reports a patch that fails as FAILED, and still processes the remaining handles", async () => {
    fetchMock
      .mockResolvedValueOnce({ _id: "id-1" })
      .mockResolvedValueOnce({ _id: "id-2" });
    commitMock
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce({});

    const result = await markProductsSold(["anillo-plata", "aretes-luna"]);

    expect(commitMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      marked: ["aretes-luna"],
      missing: [],
      failed: ["anillo-plata"],
    });
  });

  it("reports a failed lookup as FAILED: not knowing whether the piece exists is not 'missing'", async () => {
    fetchMock
      .mockRejectedValueOnce(new Error("503 from Sanity"))
      .mockResolvedValueOnce({ _id: "id-2" });
    commitMock.mockResolvedValue({});

    const result = await markProductsSold(["anillo-plata", "aretes-luna"]);

    expect(patchMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      marked: ["aretes-luna"],
      missing: [],
      failed: ["anillo-plata"],
    });
  });

  it("accounts for every handle in exactly one list, in the order asked", async () => {
    fetchMock
      .mockResolvedValueOnce({ _id: "id-a" })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ _id: "id-c" })
      .mockResolvedValueOnce({ _id: "id-d" });
    commitMock
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error("conflict"))
      .mockResolvedValueOnce({});

    const result = await markProductsSold(["a", "b", "c", "d"]);

    expect(result).toEqual({ marked: ["a", "d"], missing: ["b"], failed: ["c"] });
  });

  it("never exposes what went wrong: the result carries handles only", async () => {
    fetchMock.mockResolvedValueOnce({ _id: "id-1" });
    commitMock.mockRejectedValueOnce(new Error("token sk-secret rejected"));

    const result = await markProductsSold(["anillo-plata"]);

    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("fails EVERY handle, without fetching, when the write client is unavailable (SANITY_WRITE_TOKEN unset)", async () => {
    getSanityWriteClientMock.mockReturnValueOnce(undefined);

    const result = await markProductsSold(["anillo-plata", "aretes-luna"]);

    // Never a silent no-op: these pieces are still on sale, and the caller must know.
    expect(result).toEqual({
      marked: [],
      missing: [],
      failed: ["anillo-plata", "aretes-luna"],
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(patchMock).not.toHaveBeenCalled();
  });

  it("fails every handle, rather than throw, when the write client cannot even be built", async () => {
    getSanityWriteClientMock.mockImplementationOnce(() => {
      throw new Error("Invalid project id");
    });

    await expect(markProductsSold(["anillo-plata"])).resolves.toEqual({
      marked: [],
      missing: [],
      failed: ["anillo-plata"],
    });
  });

  it("returns an empty result for an empty handle list, without touching the write client", async () => {
    const result = await markProductsSold([]);

    expect(result).toEqual({ marked: [], missing: [], failed: [] });
    expect(getSanityWriteClientMock).not.toHaveBeenCalled();
  });

  it("is idempotent: marking an already-sold piece again is a normal success", async () => {
    fetchMock.mockResolvedValue({ _id: "id-1" });
    commitMock.mockResolvedValue({});

    const first = await markProductsSold(["anillo-plata"]);
    const second = await markProductsSold(["anillo-plata"]);

    expect(first).toEqual(second);
    expect(second.failed).toEqual([]);
    expect(setMock).toHaveBeenCalledTimes(2);
    expect(setMock).toHaveBeenLastCalledWith({ status: "sold" });
  });

  it("never throws and never logs, whatever fails", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
    fetchMock.mockRejectedValue(new Error("everything is down"));

    await expect(markProductsSold(["a", "b"])).resolves.toEqual({
      marked: [],
      missing: [],
      failed: ["a", "b"],
    });

    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });
});
