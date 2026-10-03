import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A layout's redirect does NOT stop its page: Next renders a layout and the
// pages under it in parallel, so a page that reads data has to authorize
// itself. These tests pin that for the three inventory pages (Calculadora,
// Inventario, Inversiones) exactly like tests/admin-page-guards.test.ts does
// for Mensajes: requireAdmin() redirects (it THROWS, like Next's real
// redirect) and the data layer must never be queried.
vi.mock("server-only", () => ({}));

const requireAdminMock = vi.fn();
vi.mock("@/lib/admin/auth/session", () => ({
  requireAdmin: (...args: unknown[]) => requireAdminMock(...args),
}));

const listMaterialsMock = vi.fn();
const listMovementsMock = vi.fn();
vi.mock("@/lib/admin/data/materials", () => ({
  listMaterials: (...args: unknown[]) => listMaterialsMock(...args),
  listMovements: (...args: unknown[]) => listMovementsMock(...args),
}));

const listPurchasesMock = vi.fn();
const sumPurchasesMock = vi.fn();
vi.mock("@/lib/admin/data/purchases", () => ({
  PURCHASE_SUM_LIMIT: 2000,
  listPurchases: (...args: unknown[]) => listPurchasesMock(...args),
  sumPurchases: (...args: unknown[]) => sumPurchasesMock(...args),
}));

// Server Actions are irrelevant here (and pull in next/cache); their own
// authorization is covered in tests/admin-inventory-actions.test.ts.
vi.mock("@/app/admin/(panel)/calculadora/actions", () => ({
  registerCastingAction: vi.fn(),
}));
vi.mock("@/app/admin/(panel)/inventario/actions", () => ({
  createMaterialAction: vi.fn(),
  adjustStockAction: vi.fn(),
}));
vi.mock("@/app/admin/(panel)/inversiones/actions", () => ({
  recordPurchaseAction: vi.fn(),
}));
vi.mock("@/app/admin/(panel)/actions", () => ({ logoutAction: vi.fn() }));
vi.mock("@/components/admin/AdminShell", () => ({
  AdminShell: (props: { children: unknown }) => props.children,
}));

import AdminPanelLayout from "@/app/admin/(panel)/layout";
import AdminCalculatorPage from "@/app/admin/(panel)/calculadora/page";
import AdminInventoryPage from "@/app/admin/(panel)/inventario/page";
import AdminInvestmentsPage from "@/app/admin/(panel)/inversiones/page";

const REDIRECT = "NEXT_REDIRECT /admin/login";
const ADMIN = { uid: "uid-1", email: "admin@example.com" };

const DATA_MOCKS = [
  listMaterialsMock,
  listMovementsMock,
  listPurchasesMock,
  sumPurchasesMock,
];

function expectNoDataAccess() {
  for (const mock of DATA_MOCKS) {
    expect(mock).not.toHaveBeenCalled();
  }
}

const PAGES: Array<{
  name: string;
  render: () => Promise<unknown>;
  reads: () => Array<ReturnType<typeof vi.fn>>;
}> = [
  {
    name: "Calculadora",
    render: () => AdminCalculatorPage(),
    reads: () => [listMaterialsMock],
  },
  {
    name: "Inventario",
    render: () =>
      AdminInventoryPage({ searchParams: Promise.resolve({ material: "m1" }) }),
    reads: () => [listMaterialsMock, listMovementsMock],
  },
  {
    name: "Inversiones",
    render: () => AdminInvestmentsPage({ searchParams: Promise.resolve({}) }),
    reads: () => [listPurchasesMock, sumPurchasesMock, listMaterialsMock],
  },
];

beforeEach(() => {
  vi.resetAllMocks();
  // Default: NOT an admin — requireAdmin() redirects (throws).
  requireAdminMock.mockRejectedValue(new Error(REDIRECT));
  listMaterialsMock.mockResolvedValue([]);
  listMovementsMock.mockResolvedValue({ movements: [], hasNextPage: false });
  listPurchasesMock.mockResolvedValue({ purchases: [], hasNextPage: false });
  sumPurchasesMock.mockResolvedValue({ totalCost: 0, count: 0, truncated: false });
});

afterEach(() => {
  vi.useRealTimers();
});

describe.each(PAGES)("$name page", ({ render, reads }) => {
  it("redirects a non-admin BEFORE any data access", async () => {
    await expect(render()).rejects.toThrow(REDIRECT);

    expect(requireAdminMock).toHaveBeenCalledTimes(1);
    expectNoDataAccess();
  });

  it("authorizes first and only then reads, for an admin", async () => {
    requireAdminMock.mockResolvedValue(ADMIN);

    await render();

    const readers = reads();
    for (const read of readers) {
      expect(read).toHaveBeenCalled();
      expect(requireAdminMock.mock.invocationCallOrder[0]).toBeLessThan(
        read.mock.invocationCallOrder[0],
      );
    }
  });

  it("does not crash the panel when the data layer fails or is unconfigured", async () => {
    requireAdminMock.mockResolvedValue(ADMIN);
    for (const read of reads()) {
      read.mockRejectedValue(new Error("5 NOT_FOUND"));
    }
    await expect(render()).resolves.toBeDefined();

    for (const read of reads()) {
      read.mockResolvedValue(null);
    }
    await expect(render()).resolves.toBeDefined();
  });

  it("never queries for a non-admin even when rendered in parallel with the layout, as Next does", async () => {
    const settled = await Promise.allSettled([
      AdminPanelLayout({ children: null }),
      render(),
    ]);

    expect(settled.map((outcome) => outcome.status)).toEqual([
      "rejected",
      "rejected",
    ]);
    expectNoDataAccess();
  });
});

describe("Inventario page: search params", () => {
  beforeEach(() => {
    requireAdminMock.mockResolvedValue(ADMIN);
  });

  it("loads the history of a well-formed material id, at the requested page", async () => {
    await AdminInventoryPage({
      searchParams: Promise.resolve({ material: "m1", page: "3" }),
    });

    expect(listMovementsMock).toHaveBeenCalledWith("m1", 3);
  });

  it.each([
    ["a path-like id", "a/b/c"],
    ["a parent escape", "../secrets"],
    ["an empty id", ""],
    ["an overlong id", "a".repeat(129)],
  ])("ignores %s without querying movements", async (_label, material) => {
    await AdminInventoryPage({ searchParams: Promise.resolve({ material }) });

    expect(listMovementsMock).not.toHaveBeenCalled();
  });

  it("reads no history when no material is selected", async () => {
    await AdminInventoryPage({ searchParams: Promise.resolve({}) });

    expect(listMaterialsMock).toHaveBeenCalledTimes(1);
    expect(listMovementsMock).not.toHaveBeenCalled();
  });
});

describe("Inversiones page: period and page params", () => {
  beforeEach(() => {
    requireAdminMock.mockResolvedValue(ADMIN);
    // 2026-10-02 12:00 in Mexico City.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-02T18:00:00Z"));
  });

  it("defaults to this month, in Mexico time, and totals the same range it lists", async () => {
    await AdminInvestmentsPage({ searchParams: Promise.resolve({}) });

    const [range, page] = listPurchasesMock.mock.calls[0];
    expect((range as { start: Date }).start.toISOString()).toBe("2026-10-01T06:00:00.000Z");
    expect((range as { end: Date }).end.toISOString()).toBe("2026-11-01T06:00:00.000Z");
    expect(page).toBe(1);
    expect(sumPurchasesMock).toHaveBeenCalledWith(range);
  });

  it("honours last month and this year and the page number", async () => {
    await AdminInvestmentsPage({
      searchParams: Promise.resolve({ period: "last-month", page: "2" }),
    });
    const [lastMonth, page] = listPurchasesMock.mock.calls[0];
    expect((lastMonth as { start: Date }).start.toISOString()).toBe("2026-09-01T06:00:00.000Z");
    expect(page).toBe(2);

    listPurchasesMock.mockClear();
    await AdminInvestmentsPage({
      searchParams: Promise.resolve({ period: "this-year" }),
    });
    const [thisYear] = listPurchasesMock.mock.calls[0];
    expect((thisYear as { start: Date }).start.toISOString()).toBe("2026-01-01T06:00:00.000Z");
    expect((thisYear as { end: Date }).end.toISOString()).toBe("2027-01-01T06:00:00.000Z");
  });

  it.each(["forever", "", "__proto__"])(
    "falls back to this month for the unknown period %j",
    async (period) => {
      await AdminInvestmentsPage({ searchParams: Promise.resolve({ period }) });

      const [range] = listPurchasesMock.mock.calls[0];
      expect((range as { start: Date }).start.toISOString()).toBe("2026-10-01T06:00:00.000Z");
    },
  );

  it.each(["0", "-2", "abc", "1.5"])(
    "falls back to the first page for the page %j",
    async (page) => {
      await AdminInvestmentsPage({ searchParams: Promise.resolve({ page }) });

      expect(listPurchasesMock.mock.calls[0][1]).toBe(1);
    },
  );
});
