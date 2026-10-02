import { beforeEach, describe, expect, it, vi } from "vitest";

// A layout's redirect does NOT stop its page: Next renders a layout and the
// pages under it in parallel, so a page that reads data has to authorize
// itself. These tests pin that for the two admin entry points that matter,
// the (panel) layout and the Mensajes page, by making requireAdmin() redirect
// (it THROWS, like Next's real redirect) and asserting the data layer is
// never queried.
const requireAdminMock = vi.fn();
vi.mock("@/lib/admin/auth/session", () => ({
  requireAdmin: (...args: unknown[]) => requireAdminMock(...args),
}));

const listContactMessagesMock = vi.fn();
vi.mock("@/lib/admin/data/contact-messages", () => ({
  listContactMessages: (...args: unknown[]) => listContactMessagesMock(...args),
}));

// Server Actions are irrelevant here (and pull in next/cache); their own
// authorization is covered in tests/admin-mark-read-action.test.ts and
// tests/admin-auth-actions.test.ts.
vi.mock("@/app/admin/(panel)/mensajes/actions", () => ({
  markMessageReadAction: vi.fn(),
}));
vi.mock("@/app/admin/(panel)/actions", () => ({ logoutAction: vi.fn() }));

vi.mock("@/components/admin/AdminShell", () => ({
  AdminShell: (props: { children: unknown }) => props.children,
}));

import AdminPanelLayout from "@/app/admin/(panel)/layout";
import AdminMessagesPage from "@/app/admin/(panel)/mensajes/page";
import { AdminShell } from "@/components/admin/AdminShell";

const REDIRECT = "NEXT_REDIRECT /admin/login";

function messagesPageProps(search: { page?: string } = {}) {
  return { searchParams: Promise.resolve(search) };
}

beforeEach(() => {
  vi.resetAllMocks();
  // Default: NOT an admin — requireAdmin() redirects (throws).
  requireAdminMock.mockRejectedValue(new Error(REDIRECT));
  listContactMessagesMock.mockResolvedValue({ messages: [], hasNextPage: false });
});

describe("(panel) layout", () => {
  it("redirects a non-admin and renders nothing", async () => {
    await expect(
      AdminPanelLayout({ children: "secret panel content" }),
    ).rejects.toThrow(REDIRECT);

    expect(requireAdminMock).toHaveBeenCalledTimes(1);
    expect(listContactMessagesMock).not.toHaveBeenCalled();
  });

  it("wraps the children in the admin shell for an admin", async () => {
    requireAdminMock.mockResolvedValue({ uid: "uid-1", email: "admin@example.com" });

    const element = await AdminPanelLayout({ children: "panel content" });

    expect(element.type).toBe(AdminShell);
    expect(element.props.children).toBe("panel content");
  });
});

describe("Mensajes page", () => {
  it("redirects a non-admin BEFORE any data access", async () => {
    await expect(AdminMessagesPage(messagesPageProps({ page: "2" }))).rejects.toThrow(
      REDIRECT,
    );

    expect(requireAdminMock).toHaveBeenCalledTimes(1);
    expect(listContactMessagesMock).not.toHaveBeenCalled();
  });

  it("authorizes first and only then queries Firestore, for an admin", async () => {
    requireAdminMock.mockResolvedValue({ uid: "uid-1", email: "admin@example.com" });

    await AdminMessagesPage(messagesPageProps({ page: "3" }));

    expect(listContactMessagesMock).toHaveBeenCalledTimes(1);
    expect(listContactMessagesMock).toHaveBeenCalledWith(3);
    expect(requireAdminMock.mock.invocationCallOrder[0]).toBeLessThan(
      listContactMessagesMock.mock.invocationCallOrder[0],
    );
  });
});

describe("layout and page rendered in parallel, as Next does", () => {
  it("never queries Firestore for a non-admin: the page does not depend on the layout's gate", async () => {
    const settled = await Promise.allSettled([
      AdminPanelLayout({ children: null }),
      AdminMessagesPage(messagesPageProps()),
    ]);

    expect(settled.map((outcome) => outcome.status)).toEqual([
      "rejected",
      "rejected",
    ]);
    expect(listContactMessagesMock).not.toHaveBeenCalled();
  });
});
