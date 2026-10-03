// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Renders the real Mensajes page (a Server Component is just an async function
// returning an element tree) with its collaborators mocked: authorization and
// the data layer are covered in tests/admin-page-guards.test.ts and
// tests/contact-messages-data.test.ts; this file pins what each message row
// offers for answering it.
const requireAdminMock = vi.fn();
vi.mock("@/lib/admin/auth/session", () => ({
  requireAdmin: (...args: unknown[]) => requireAdminMock(...args),
}));

const listContactMessagesMock = vi.fn();
vi.mock("@/lib/admin/data/contact-messages", () => ({
  listContactMessages: (...args: unknown[]) => listContactMessagesMock(...args),
}));

vi.mock("@/app/admin/(panel)/mensajes/actions", () => ({
  markMessageReadAction: vi.fn(),
}));

import AdminMessagesPage from "@/app/admin/(panel)/mensajes/page";

interface StoredMessage {
  id: string;
  name: string;
  email: string;
  message: string;
  createdAt: Date | null;
  read: boolean;
}

const UNREAD: StoredMessage = {
  id: "m1",
  name: "Ana",
  email: "ana@example.com",
  message: "Hola, me interesa el anillo.\n¿Tienen talla 7?",
  // 21:30 on 1 Oct in Mexico City.
  createdAt: new Date("2026-10-02T03:30:00Z"),
  read: false,
};

const READ: StoredMessage = {
  id: "m2",
  name: "",
  email: "luis@example.com",
  message: "Gracias por todo",
  createdAt: null,
  read: true,
};

async function renderPage(messages: StoredMessage[]) {
  listContactMessagesMock.mockResolvedValue({ messages, hasNextPage: false });
  render(await AdminMessagesPage({ searchParams: Promise.resolve({}) }));
}

function hrefOf(link: HTMLElement): string {
  return link.getAttribute("href") ?? "";
}

beforeEach(() => {
  vi.resetAllMocks();
  requireAdminMock.mockResolvedValue({ uid: "uid-1", email: "admin@example.com" });
});

describe("Mensajes page — replying", () => {
  it("offers a Responder link that opens a reply draft quoting the message", async () => {
    await renderPage([UNREAD]);

    const reply = screen.getByRole("link", { name: "Responder a Ana" });
    expect(reply).toHaveTextContent("Responder");

    const href = hrefOf(reply);
    expect(href.startsWith("mailto:ana@example.com?subject=")).toBe(true);

    const { searchParams } = new URL(href);
    expect(searchParams.get("subject")).toBe("Re: tu mensaje a nerea");

    const body = searchParams.get("body") ?? "";
    // The date is the atelier's own time (Mexico City), not the server's.
    expect(body).toMatch(/— Escribiste el 1 oct\.? 2026, 9:30\s?p\.\s?m\.:/);
    expect(body).toContain("\r\n> Hola, me interesa el anillo.\r\n> ¿Tienen talla 7?");
  });

  it("keeps the email link and the mark-as-read button", async () => {
    await renderPage([UNREAD]);

    expect(hrefOf(screen.getByRole("link", { name: "ana@example.com" }))).toBe(
      "mailto:ana@example.com",
    );
    expect(
      screen.getByRole("button", { name: "Marcar como leído" }),
    ).toBeInTheDocument();
  });

  it("offers Responder on a read message too, naming it by its email when it has no name", async () => {
    await renderPage([READ]);

    const reply = screen.getByRole("link", { name: "Responder a luis@example.com" });
    expect(hrefOf(reply).startsWith("mailto:luis@example.com?subject=")).toBe(true);
    // No date known: the heading simply has none.
    expect(new URL(hrefOf(reply)).searchParams.get("body")).toContain(
      "— Escribiste:\r\n> Gracias por todo",
    );
    expect(screen.getByText("Leído")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Marcar como leído" }),
    ).not.toBeInTheDocument();
  });

  it("gives every message its own Responder link", async () => {
    await renderPage([UNREAD, READ]);

    expect(screen.getAllByRole("link", { name: /^Responder a / })).toHaveLength(2);
  });

  it("offers no Responder link for a message that has no address", async () => {
    await renderPage([{ ...UNREAD, email: "" }]);

    expect(screen.queryByRole("link", { name: /Responder/ })).not.toBeInTheDocument();
  });

  it("cannot be turned into extra mailto headers by a hostile stored address", async () => {
    await renderPage([{ ...UNREAD, email: "a@b.co?bcc=evil.zz&cc=evil.zz" }]);

    const href = hrefOf(screen.getByRole("link", { name: "Responder a Ana" }));
    const { searchParams } = new URL(href);

    expect([...searchParams.keys()]).toEqual(["subject", "body"]);
    expect(searchParams.get("bcc")).toBeNull();
    expect(searchParams.get("cc")).toBeNull();
  });
});
