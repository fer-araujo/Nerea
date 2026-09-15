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
  vi.clearAllMocks();
});

describe("markProductsSold", () => {
  it("resolves a handle to its Sanity _id via a parameterized query, then patches status to sold", async () => {
    fetchMock.mockResolvedValueOnce({ _id: "product-123" });
    commitMock.mockResolvedValueOnce({});

    await markProductsSold(["anillo-plata"]);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("$handle"),
      { handle: "anillo-plata" },
    );
    expect(patchMock).toHaveBeenCalledWith("product-123");
    expect(setMock).toHaveBeenCalledWith({ status: "sold" });
    expect(commitMock).toHaveBeenCalledTimes(1);
  });

  it("processes every handle in the batch independently", async () => {
    fetchMock
      .mockResolvedValueOnce({ _id: "id-1" })
      .mockResolvedValueOnce({ _id: "id-2" });
    commitMock.mockResolvedValue({});

    await markProductsSold(["anillo-plata", "aretes-luna"]);

    expect(patchMock).toHaveBeenCalledWith("id-1");
    expect(patchMock).toHaveBeenCalledWith("id-2");
    expect(commitMock).toHaveBeenCalledTimes(2);
  });

  it("skips a handle with no matching document instead of throwing, and still processes the rest", async () => {
    fetchMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ _id: "id-2" });
    commitMock.mockResolvedValue({});

    await expect(
      markProductsSold(["unknown-handle", "aretes-luna"]),
    ).resolves.toBeUndefined();

    expect(patchMock).toHaveBeenCalledTimes(1);
    expect(patchMock).toHaveBeenCalledWith("id-2");
  });

  it("never throws when a patch/commit call rejects, and still processes the remaining handles", async () => {
    fetchMock
      .mockResolvedValueOnce({ _id: "id-1" })
      .mockResolvedValueOnce({ _id: "id-2" });
    commitMock
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce({});

    await expect(
      markProductsSold(["anillo-plata", "aretes-luna"]),
    ).resolves.toBeUndefined();

    expect(commitMock).toHaveBeenCalledTimes(2);
  });

  it("no-ops without throwing when the write client is unavailable (SANITY_WRITE_TOKEN unset)", async () => {
    getSanityWriteClientMock.mockReturnValueOnce(undefined);

    await expect(markProductsSold(["anillo-plata"])).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("no-ops for an empty handle list without touching the write client", async () => {
    await markProductsSold([]);
    expect(getSanityWriteClientMock).not.toHaveBeenCalled();
  });
});
