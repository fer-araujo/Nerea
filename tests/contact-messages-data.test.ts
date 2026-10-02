import { beforeEach, describe, expect, it, vi } from "vitest";

// Firestore is faked at the edge (getAdminDb + the FieldValue sentinel), so
// these tests cover the data layer's own rules: what gets stored, how pages
// are cut, and how defensively documents are read back.
vi.mock("server-only", () => ({}));

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { serverTimestamp: () => "SERVER_TIMESTAMP_SENTINEL" },
}));

const addMock = vi.fn();
const updateMock = vi.fn();
const docMock = vi.fn();
const getMock = vi.fn();
const limitMock = vi.fn();
const offsetMock = vi.fn();
const orderByMock = vi.fn();
const collectionMock = vi.fn();
let dbConfigured = true;

vi.mock("@/lib/admin/firebase/admin", () => ({
  getAdminDb: () => (dbConfigured ? { collection: collectionMock } : undefined),
}));

import {
  MESSAGES_PAGE_SIZE,
  listContactMessages,
  markContactMessageRead,
  saveContactMessage,
} from "@/lib/admin/data/contact-messages";

beforeEach(() => {
  vi.resetAllMocks();
  dbConfigured = true;
  collectionMock.mockImplementation(() => ({
    add: addMock,
    doc: docMock,
    orderBy: orderByMock,
  }));
  docMock.mockImplementation(() => ({ update: updateMock }));
  orderByMock.mockImplementation(() => ({ offset: offsetMock }));
  offsetMock.mockImplementation(() => ({ limit: limitMock }));
  limitMock.mockImplementation(() => ({ get: getMock }));
  addMock.mockResolvedValue({ id: "new-id" });
  updateMock.mockResolvedValue(undefined);
});

// A minimal QueryDocumentSnapshot stand-in.
function snapshotDoc(id: string, data: Record<string, unknown>) {
  return { id, data: () => data };
}

describe("saveContactMessage", () => {
  it("stores exactly name, email, message, a server timestamp and read:false in contactMessages", async () => {
    const saved = await saveContactMessage({
      name: "Ana",
      email: "ana@example.com",
      message: "Hola",
    });

    expect(saved).toBe(true);
    expect(collectionMock).toHaveBeenCalledWith("contactMessages");
    expect(addMock).toHaveBeenCalledWith({
      name: "Ana",
      email: "ana@example.com",
      message: "Hola",
      createdAt: "SERVER_TIMESTAMP_SENTINEL",
      read: false,
    });
  });

  it("does not persist unexpected extra properties", async () => {
    const input = {
      name: "Ana",
      email: "ana@example.com",
      message: "Hola",
      read: true,
      admin: true,
    };

    await saveContactMessage(input);

    const stored = addMock.mock.calls[0][0];
    expect(Object.keys(stored).sort()).toEqual(
      ["createdAt", "email", "message", "name", "read"].sort(),
    );
    expect(stored.read).toBe(false);
  });

  it("returns false and writes nothing when Firebase is not configured", async () => {
    dbConfigured = false;

    await expect(
      saveContactMessage({ name: "Ana", email: "ana@example.com", message: "Hola" }),
    ).resolves.toBe(false);
    expect(addMock).not.toHaveBeenCalled();
  });

  it("rejects (rather than reporting success) when Firestore fails", async () => {
    addMock.mockRejectedValue(new Error("unavailable"));

    await expect(
      saveContactMessage({ name: "Ana", email: "ana@example.com", message: "Hola" }),
    ).rejects.toThrow("unavailable");
  });
});

describe("listContactMessages", () => {
  it("queries newest first and fetches one extra document to detect a next page", async () => {
    getMock.mockResolvedValue({ docs: [] });

    await listContactMessages(1);

    expect(collectionMock).toHaveBeenCalledWith("contactMessages");
    expect(orderByMock).toHaveBeenCalledWith("createdAt", "desc");
    expect(offsetMock).toHaveBeenCalledWith(0);
    expect(limitMock).toHaveBeenCalledWith(MESSAGES_PAGE_SIZE + 1);
  });

  it("offsets by whole pages", async () => {
    getMock.mockResolvedValue({ docs: [] });

    await listContactMessages(3);

    expect(offsetMock).toHaveBeenCalledWith(2 * MESSAGES_PAGE_SIZE);
  });

  it.each([0, -1, 1.5, Number.NaN, 201, 1e9])(
    "falls back to the first page for the out-of-range page %s",
    async (page) => {
      getMock.mockResolvedValue({ docs: [] });

      await listContactMessages(page);

      expect(offsetMock).toHaveBeenCalledWith(0);
    },
  );

  it("returns a full page and reports a next page when the extra document exists", async () => {
    const docs = Array.from({ length: MESSAGES_PAGE_SIZE + 1 }, (_, index) =>
      snapshotDoc(`id-${index}`, { name: `n${index}`, email: "a@b.co", message: "m" }),
    );
    getMock.mockResolvedValue({ docs });

    const page = await listContactMessages(1);

    expect(page?.messages).toHaveLength(MESSAGES_PAGE_SIZE);
    expect(page?.messages[0].id).toBe("id-0");
    expect(page?.hasNextPage).toBe(true);
  });

  it("reports no next page on the last, partial page", async () => {
    getMock.mockResolvedValue({
      docs: [snapshotDoc("id-0", { name: "n", email: "a@b.co", message: "m" })],
    });

    const page = await listContactMessages(1);

    expect(page?.messages).toHaveLength(1);
    expect(page?.hasNextPage).toBe(false);
  });

  it("maps a Firestore Timestamp to a Date and defaults read to false", async () => {
    const createdAt = new Date("2026-10-02T18:30:00Z");
    getMock.mockResolvedValue({
      docs: [
        snapshotDoc("id-0", {
          name: "Ana",
          email: "ana@example.com",
          message: "Hola",
          createdAt: { toDate: () => createdAt },
        }),
      ],
    });

    const page = await listContactMessages(1);

    expect(page?.messages[0]).toEqual({
      id: "id-0",
      name: "Ana",
      email: "ana@example.com",
      message: "Hola",
      createdAt,
      read: false,
    });
  });

  it("coerces hand-edited or malformed documents instead of throwing", async () => {
    getMock.mockResolvedValue({
      docs: [
        snapshotDoc("id-0", {
          name: 42,
          email: null,
          message: { nested: true },
          createdAt: "yesterday",
          read: "yes",
        }),
      ],
    });

    const page = await listContactMessages(1);

    expect(page?.messages[0]).toEqual({
      id: "id-0",
      name: "",
      email: "",
      message: "",
      createdAt: null,
      read: false,
    });
  });

  it("returns null when Firebase is not configured", async () => {
    dbConfigured = false;

    await expect(listContactMessages(1)).resolves.toBeNull();
  });
});

describe("markContactMessageRead", () => {
  it("sets read:true on the given message", async () => {
    await expect(markContactMessageRead("AbC123_-xyz")).resolves.toBe(true);

    expect(docMock).toHaveBeenCalledWith("AbC123_-xyz");
    expect(updateMock).toHaveBeenCalledWith({ read: true });
  });

  it.each([
    ["empty", ""],
    ["a nested path", "abc/def/ghi"],
    ["a parent-path escape", "../secrets"],
    ["whitespace", "abc def"],
    ["a dot", "abc.def"],
    ["overlong", "a".repeat(129)],
  ])("refuses a malformed id (%s) without touching Firestore", async (_label, id) => {
    await expect(markContactMessageRead(id)).resolves.toBe(false);

    expect(docMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("returns false when Firebase is not configured", async () => {
    dbConfigured = false;

    await expect(markContactMessageRead("abc123")).resolves.toBe(false);
  });

  it("rejects when the document does not exist or Firestore fails", async () => {
    updateMock.mockRejectedValue(new Error("5 NOT_FOUND"));

    await expect(markContactMessageRead("abc123")).rejects.toThrow("NOT_FOUND");
  });
});
