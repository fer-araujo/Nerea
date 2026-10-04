import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeFirestore, FakeTimestamp } from "@/tests/helpers/fake-firestore";

// The three actions run against the REAL zod schemas, domain rules and data
// layer, with Firestore faked at the very edge (getAdminDb) and the catalog
// and Sanity's write path mocked at their own seams, so "never touches
// anything before authorizing" and "rejects bad input before the database"
// are asserted where they matter.
vi.mock("server-only", () => ({}));

vi.mock("firebase-admin/firestore", async () => {
  const fake = await import("@/tests/helpers/fake-firestore");
  return {
    FieldValue: { serverTimestamp: () => fake.SERVER_TIMESTAMP },
    Timestamp: { fromDate: (date: Date) => new fake.FakeTimestamp(date) },
  };
});

const requireAdminMock = vi.fn();
vi.mock("@/lib/admin/auth/session", () => ({
  requireAdmin: (...args: unknown[]) => requireAdminMock(...args),
}));

const revalidatePathMock = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));

let fake: FakeFirestore;
const getAdminDbMock = vi.fn();
vi.mock("@/lib/admin/firebase/admin", () => ({
  getAdminDb: () => getAdminDbMock(),
}));

const getCatalogProductsMock = vi.fn();
vi.mock("@/lib/admin/data/catalog", () => ({
  getCatalogProducts: (...args: unknown[]) => getCatalogProductsMock(...args),
}));

// markProductsSold reports what happened to each handle (marked / missing /
// failed); how it decides that is covered in tests/mark-sold.test.ts.
const markProductsSoldMock = vi.fn();
vi.mock("@/lib/commerce/sanity/mark-sold", () => ({
  markProductsSold: (...args: unknown[]) => markProductsSoldMock(...args),
}));

// What Stripe answers about a payment's fee is covered in tests/stripe-fees.test.ts;
// here it is the answer "Actualizar comisión" acts on.
const fetchStripeFeesMock = vi.fn();
vi.mock("@/lib/admin/data/stripe-fees", () => ({
  fetchStripeFees: (...args: unknown[]) => fetchStripeFeesMock(...args),
}));

import { savePieceCostAction } from "@/app/admin/(panel)/piezas/actions";
import {
  recordManualSaleAction,
  refreshSaleFeeAction,
  voidSaleAction,
} from "@/app/admin/(panel)/ventas/actions";
import { mexicoTodayIso } from "@/lib/admin/domain/periods";
import { MAX_SALE_ITEMS } from "@/lib/admin/domain/sales";

const ADMIN = { uid: "uid-admin-1", email: "admin@example.com" };
const TODAY = mexicoTodayIso();

function form(fields: Record<string, string | string[] | Blob>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      data.append(key, item);
    }
  }
  return data;
}

interface CatalogEntry {
  handle: string;
  title: string;
  price: number;
  availability: "available" | "sold";
}

const DEFAULT_CATALOG: CatalogEntry[] = [
  { handle: "anillo-luna", title: "Anillo Luna", price: 185_000, availability: "available" },
  { handle: "aretes-sol", title: "Aretes Sol", price: 90_000, availability: "available" },
];

function stockCatalog(entries: CatalogEntry[] = DEFAULT_CATALOG) {
  getCatalogProductsMock.mockImplementation(async (handles: string[]) => {
    return new Map(
      entries
        .filter((entry) => handles.includes(entry.handle))
        .map((entry) => [entry.handle, { ...entry, categoryTitle: null }] as const),
    );
  });
}

function seedSale(id: string, overrides: Record<string, unknown> = {}) {
  fake.seed(`sales/${id}`, {
    source: "manual",
    status: "active",
    date: new FakeTimestamp(new Date("2026-10-01T06:00:00Z")),
    items: [{ handle: "anillo-luna", title: "Anillo Luna", price: 185_000 }],
    subtotal: 185_000,
    shipping: 0,
    total: 185_000,
    currency: "MXN",
    costOfGoods: 0,
    costPending: true,
    ...overrides,
  });
}

// An online sale whose Stripe fee could not be read when the payment came in.
function seedPendingStripeSale(id: string, overrides: Record<string, unknown> = {}) {
  seedSale(id, {
    source: "stripe",
    livemode: true,
    stripeSessionId: id.replace(/^stripe_/, ""),
    feePending: true,
    ...overrides,
  });
}

function messageOf(result: unknown): string {
  return (result as { message: string }).message;
}

const PIECE_FORM = {
  handle: "anillo-luna",
  metal: "1200.50",
  stones: "300",
  other: "50",
  labor: "450",
  metalGrams: "12.5",
  materialId: "silver",
  note: "Piedra de la clienta",
};

const SALE_FORM = {
  date: TODAY,
  itemHandle: "anillo-luna",
  itemPrice: "1850.00",
  itemOption: "Talla 7",
  shipping: "150",
  note: "Entrega en persona",
  markSold: "on",
};

beforeEach(() => {
  vi.resetAllMocks();
  fake = new FakeFirestore();
  getAdminDbMock.mockReturnValue(fake);
  requireAdminMock.mockResolvedValue(ADMIN);
  // By default every handle is marked.
  markProductsSoldMock.mockImplementation(async (handles: string[]) => ({
    marked: handles,
    missing: [],
    failed: [],
  }));
  // By default Stripe has the fee: Stripe's fee with the IVA, and the net.
  fetchStripeFeesMock.mockResolvedValue({ fee: 7_540, net: 192_460 });
  stockCatalog();
});

// Every action is held to the same contract.
const ACTIONS: Array<{
  name: string;
  run: (formData: FormData) => Promise<unknown>;
  validForm: () => FormData;
  seed: () => void;
  refreshes: string[];
}> = [
  {
    name: "savePieceCostAction",
    run: savePieceCostAction,
    validForm: () => form(PIECE_FORM),
    seed: () => undefined,
    refreshes: ["/admin/piezas"],
  },
  {
    name: "recordManualSaleAction",
    run: recordManualSaleAction,
    validForm: () => form(SALE_FORM),
    seed: () => undefined,
    refreshes: ["/admin/piezas", "/admin/ventas"],
  },
  {
    name: "voidSaleAction",
    run: voidSaleAction,
    validForm: () => form({ saleId: "sale1" }),
    seed: () => seedSale("sale1"),
    refreshes: ["/admin/piezas", "/admin/ventas"],
  },
  {
    name: "refreshSaleFeeAction",
    run: refreshSaleFeeAction,
    validForm: () => form({ saleId: "stripe_cs_live_1" }),
    seed: () => seedPendingStripeSale("stripe_cs_live_1"),
    refreshes: ["/admin/piezas", "/admin/ventas"],
  },
];

describe.each(ACTIONS)("$name", ({ run, validForm, seed, refreshes }) => {
  it("authorizes with requireAdmin BEFORE touching Firestore", async () => {
    seed();

    await expect(run(validForm())).resolves.toEqual({ ok: true });

    expect(requireAdminMock).toHaveBeenCalledTimes(1);
    expect(requireAdminMock.mock.invocationCallOrder[0]).toBeLessThan(
      getAdminDbMock.mock.invocationCallOrder[0],
    );
  });

  it("touches nothing, and refreshes nothing, when the caller is not an admin", async () => {
    seed();
    requireAdminMock.mockRejectedValue(new Error("NEXT_REDIRECT /admin/login"));

    await expect(run(validForm())).rejects.toThrow("NEXT_REDIRECT /admin/login");

    expect(getAdminDbMock).not.toHaveBeenCalled();
    expect(getCatalogProductsMock).not.toHaveBeenCalled();
    expect(markProductsSoldMock).not.toHaveBeenCalled();
    // Nor is Stripe asked anything on behalf of someone who is not an admin.
    expect(fetchStripeFeesMock).not.toHaveBeenCalled();
    expect(fake.committed).toHaveLength(0);
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("refreshes the pages that read what it changed, on success", async () => {
    seed();

    await run(validForm());

    expect(revalidatePathMock.mock.calls.map(([path]) => path).sort()).toEqual(
      [...refreshes].sort(),
    );
  });

  it("answers 'unavailable', not success, when Firebase is not configured", async () => {
    getAdminDbMock.mockReturnValue(undefined);

    await expect(run(validForm())).resolves.toMatchObject({
      ok: false,
      error: "unavailable",
    });
    expect(revalidatePathMock).not.toHaveBeenCalled();
    expect(markProductsSoldMock).not.toHaveBeenCalled();
    expect(fetchStripeFeesMock).not.toHaveBeenCalled();
  });

  it("returns a generic failure and leaks nothing when Firestore fails", async () => {
    seed();
    vi.spyOn(fake, "runTransaction").mockRejectedValue(new Error("secret internal detail"));

    const result = await run(validForm());

    expect(result).toMatchObject({ ok: false, error: "failed" });
    expect(JSON.stringify(result)).not.toContain("secret internal detail");
    expect(revalidatePathMock).not.toHaveBeenCalled();
    // A sale that was not recorded must not take the piece off the shelf.
    expect(markProductsSoldMock).not.toHaveBeenCalled();
  });

  it("refuses a request that is not a FormData, after authorizing and before any data access", async () => {
    await expect(run("not a form" as unknown as FormData)).resolves.toMatchObject({
      ok: false,
      error: "invalid",
    });

    expect(requireAdminMock).toHaveBeenCalledTimes(1);
    expect(getAdminDbMock).not.toHaveBeenCalled();
    expect(getCatalogProductsMock).not.toHaveBeenCalled();
  });

  it("logs nothing, neither on success nor on failure (a log line could carry amounts)", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
    seed();

    await run(validForm());
    await run(new FormData());
    getAdminDbMock.mockReturnValue(undefined);
    await run(validForm());

    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });
});

describe("savePieceCostAction", () => {
  it("stores the costs as centavos, with who changed it, and audits without values", async () => {
    const result = await savePieceCostAction(form({ ...PIECE_FORM, note: "  Piedra de la clienta  " }));

    expect(result).toEqual({ ok: true });
    expect(fake.get("pieces/anillo-luna")).toMatchObject({
      handle: "anillo-luna",
      costs: { metal: 120_050, stones: 30_000, other: 5_000, labor: 45_000 },
      metalGrams: 12.5,
      materialId: "silver",
      note: "Piedra de la clienta",
      actor: ADMIN.uid,
    });
    const [audit] = fake.directChildren("auditLog");
    expect(audit.data).toMatchObject({
      actor: ADMIN.uid,
      action: "piece.update",
      entity: "piece",
      entityId: "anillo-luna",
    });
    expect(JSON.stringify(audit.data)).not.toContain("120050");
  });

  it("counts a blank metal, stones or other as 0 and a blank labor as not recorded", async () => {
    const result = await savePieceCostAction(
      form({ handle: "aretes-sol", metal: "", stones: "250", other: "", labor: "" }),
    );

    expect(result).toEqual({ ok: true });
    const stored = fake.get("pieces/aretes-sol");
    expect(stored?.costs).toEqual({ metal: 0, stones: 25_000, other: 0 });
    for (const field of ["metalGrams", "materialId", "note"]) {
      expect(stored).not.toHaveProperty(field);
    }
  });

  it("accepts an explicit 0: a piece can really cost nothing", async () => {
    await expect(
      savePieceCostAction(form({ handle: "regalo", metal: "0" })),
    ).resolves.toEqual({ ok: true });

    expect(fake.get("pieces/regalo")?.costs).toEqual({ metal: 0, stones: 0, other: 0 });
  });

  it("refuses to save when no cost was typed at all, so an empty save cannot make a piece free", async () => {
    const result = await savePieceCostAction(form({ handle: "anillo-luna" }));

    expect(result).toMatchObject({ ok: false, error: "invalid" });
    expect(messageOf(result)).toContain("al menos un costo");
    expect(getAdminDbMock).not.toHaveBeenCalled();
  });

  it("never takes a price from the request: it lives in the catalog", async () => {
    await savePieceCostAction(form({ ...PIECE_FORM, price: "1", total: "1" }));

    const stored = JSON.stringify(fake.get("pieces/anillo-luna"));
    expect(stored).not.toContain("price");
    expect(stored).not.toContain("total");
  });

  it.each([
    ["three decimals", { metal: "12.345" }, "Metal"],
    ["a negative amount", { stones: "-5" }, "Piedras"],
    ["scientific notation", { other: "1e3" }, "Otros"],
    ["text", { labor: "abc" }, "Mano de obra"],
    ["a comma decimal", { metal: "12,50" }, "Metal"],
    ["nine digits", { metal: "100000000" }, "Metal"],
    ["more than the ceiling", { stones: "10000001" }, "Piedras"],
    ["a handle that addresses another path", { handle: "a/b/c" }, "Pieza"],
    ["a reserved handle", { handle: "__nope__" }, "Pieza"],
    ["a blank handle", { handle: "" }, "Pieza"],
    ["zero grams", { metalGrams: "0" }, "Gramos de metal"],
    ["text as grams", { metalGrams: "lots" }, "Gramos de metal"],
    ["four decimals of grams", { metalGrams: "1.2345" }, "Gramos de metal"],
    ["a material id that addresses another path", { materialId: "../x" }, "Material"],
    ["an overlong note", { note: "x".repeat(301) }, "Nota"],
  ])("rejects %s before the database, naming the field", async (_label, patch, label) => {
    const result = await savePieceCostAction(form({ ...PIECE_FORM, ...patch }));

    expect(result).toMatchObject({ ok: false, error: "invalid" });
    expect(messageOf(result)).toContain(label);
    expect(getAdminDbMock).not.toHaveBeenCalled();
    expect(fake.committed).toHaveLength(0);
  });

  it("treats a file in a text field as missing", async () => {
    const result = await savePieceCostAction(
      form({ ...PIECE_FORM, handle: new Blob(["x"]) }),
    );

    expect(result).toMatchObject({ ok: false, error: "invalid" });
    expect(getAdminDbMock).not.toHaveBeenCalled();
  });

  it("replaces an earlier cost for the same piece", async () => {
    await savePieceCostAction(form(PIECE_FORM));

    await savePieceCostAction(form({ handle: "anillo-luna", metal: "1" }));

    expect(fake.get("pieces/anillo-luna")?.costs).toEqual({ metal: 100, stones: 0, other: 0 });
    expect(fake.directChildren("pieces")).toHaveLength(1);
  });
});

describe("recordManualSaleAction", () => {
  it("records the sale with centavos, catalog titles and the admin's uid, then marks the piece sold", async () => {
    fake.seed("pieces/anillo-luna", { costs: { metal: 40_000, stones: 15_000, other: 5_000 } });

    const result = await recordManualSaleAction(form(SALE_FORM));

    expect(result).toEqual({ ok: true });
    const [sale] = fake.directChildren("sales");
    expect(sale.data).toMatchObject({
      source: "manual",
      status: "active",
      items: [
        { handle: "anillo-luna", title: "Anillo Luna", price: 185_000, option: "Talla 7" },
      ],
      subtotal: 185_000,
      shipping: 15_000,
      total: 200_000,
      costOfGoods: 60_000,
      costPending: false,
      note: "Entrega en persona",
      actor: ADMIN.uid,
    });
    expect(markProductsSoldMock).toHaveBeenCalledWith(["anillo-luna"]);
    const [audit] = fake.directChildren("auditLog");
    expect(audit.data).toMatchObject({ action: "sale.record", entity: "sale", entityId: sale.path.split("/")[1] });
  });

  it("takes the price as typed, so a discount is kept, and records several pieces at once", async () => {
    const result = await recordManualSaleAction(
      form({
        date: TODAY,
        itemHandle: ["anillo-luna", "aretes-sol"],
        itemPrice: ["1500", "900.00"],
        itemOption: ["", ""],
        shipping: "",
        markSold: "on",
      }),
    );

    expect(result).toEqual({ ok: true });
    const [sale] = fake.directChildren("sales");
    expect(sale.data).toMatchObject({
      subtotal: 240_000,
      shipping: 0,
      total: 240_000,
      items: [
        { handle: "anillo-luna", price: 150_000 },
        { handle: "aretes-sol", price: 90_000 },
      ],
    });
    expect(markProductsSoldMock).toHaveBeenCalledWith(["anillo-luna", "aretes-sol"]);
  });

  it("records the sale BEFORE marking the piece sold, never the other way round", async () => {
    let salesWhenMarked = -1;
    markProductsSoldMock.mockImplementation(async (handles: string[]) => {
      salesWhenMarked = fake.directChildren("sales").length;
      return { marked: handles, missing: [], failed: [] };
    });

    await recordManualSaleAction(form(SALE_FORM));

    expect(salesWhenMarked).toBe(1);
  });

  describe("the terminal's commission", () => {
    it("stores it in centavos on the sale, with the total the customer paid unchanged", async () => {
      const result = await recordManualSaleAction(form({ ...SALE_FORM, terminalFee: "67.50" }));

      expect(result).toEqual({ ok: true });
      const [sale] = fake.directChildren("sales");
      expect(sale.data).toMatchObject({
        subtotal: 185_000,
        shipping: 15_000,
        total: 200_000,
        terminalFee: 6_750,
      });
    });

    it.each([
      ["blank", { terminalFee: "" }],
      ["zero", { terminalFee: "0" }],
      ["not sent at all", {}],
    ])("stores no commission when it is %s (cash)", async (_label, extra) => {
      await recordManualSaleAction(form({ ...SALE_FORM, ...extra }));

      const [sale] = fake.directChildren("sales");
      expect(sale.data).not.toHaveProperty("terminalFee");
    });

    it.each([
      ["text", "abc"],
      ["more than two decimals", "1.234"],
      ["negative", "-5"],
      ["in exponent notation", "1e3"],
    ])("rejects a commission that is %s before the database, naming the field", async (_label, terminalFee) => {
      const result = await recordManualSaleAction(form({ ...SALE_FORM, terminalFee }));

      expect(result).toMatchObject({ ok: false, error: "invalid" });
      expect(messageOf(result)).toContain("Comisión");
      expect(getAdminDbMock).not.toHaveBeenCalled();
    });

    it("rejects an absurdly large commission", async () => {
      const result = await recordManualSaleAction(form({ ...SALE_FORM, terminalFee: "100000.01" }));

      expect(result).toMatchObject({ ok: false, error: "invalid" });
      expect(messageOf(result)).toContain("Comisión");
    });

    it("refuses a commission larger than what the customer paid, recording nothing", async () => {
      // 1,850 of piece + 150 of shipping = 2,000 paid.
      const result = await recordManualSaleAction(form({ ...SALE_FORM, terminalFee: "2000.01" }));

      expect(result).toMatchObject({ ok: false, error: "invalid-sale" });
      expect(fake.directChildren("sales")).toHaveLength(0);
      expect(markProductsSoldMock).not.toHaveBeenCalled();
    });
  });

  it("does not touch the store when 'Marcar como vendida en la tienda' is off", async () => {
    // An unticked checkbox posts nothing at all.
    const withoutCheckbox: Record<string, string> = { ...SALE_FORM };
    delete withoutCheckbox.markSold;

    const result = await recordManualSaleAction(form(withoutCheckbox));

    expect(result).toEqual({ ok: true });
    expect(fake.directChildren("sales")).toHaveLength(1);
    expect(markProductsSoldMock).not.toHaveBeenCalled();
  });

  describe("when pieces cannot be marked sold in the store", () => {
    const TWO_PIECES = {
      date: TODAY,
      itemHandle: ["anillo-luna", "aretes-sol"],
      itemPrice: ["1850", "900"],
      itemOption: ["", ""],
      markSold: "on",
    };

    it("records the sale anyway and answers a typed warning that NAMES the piece", async () => {
      markProductsSoldMock.mockResolvedValue({ marked: [], missing: [], failed: ["anillo-luna"] });

      const result = await recordManualSaleAction(form(SALE_FORM));

      expect(result).toEqual({
        ok: true,
        warning: {
          code: "store-not-updated",
          message: expect.stringContaining("«Anillo Luna»"),
        },
      });
      expect(messageOf((result as { warning: unknown }).warning)).toContain("Studio");
      // The sale is on record, and the screens refresh as for any sale.
      expect(fake.directChildren("sales")).toHaveLength(1);
      expect(revalidatePathMock.mock.calls.map(([path]) => path).sort()).toEqual([
        "/admin/piezas",
        "/admin/ventas",
      ]);
    });

    it("is the same warning when the Sanity write token is missing: markProductsSold reports every piece failed", async () => {
      // The action does not look at the token itself: a missing one comes back
      // as every handle in `failed`, never as a silent no-op.
      markProductsSoldMock.mockImplementation(async (handles: string[]) => ({
        marked: [],
        missing: [],
        failed: handles,
      }));

      const result = await recordManualSaleAction(form(TWO_PIECES));

      expect(markProductsSoldMock).toHaveBeenCalledWith(["anillo-luna", "aretes-sol"]);
      const message = messageOf((result as { warning: unknown }).warning);
      expect(message).toContain("«Anillo Luna»");
      expect(message).toContain("«Aretes Sol»");
      expect(message).toContain("las piezas");
      expect(fake.directChildren("sales")).toHaveLength(1);
    });

    it("names ONLY the pieces that failed, not the ones that were marked", async () => {
      markProductsSoldMock.mockResolvedValue({
        marked: ["anillo-luna"],
        missing: [],
        failed: ["aretes-sol"],
      });

      const result = await recordManualSaleAction(form(TWO_PIECES));

      const message = messageOf((result as { warning: unknown }).warning);
      expect(message).toContain("«Aretes Sol»");
      expect(message).not.toContain("Anillo Luna");
      expect(message).toContain("la pieza");
      expect(message).not.toContain("las piezas");
    });

    it("names the piece by its catalog title, never by what the request said", async () => {
      markProductsSoldMock.mockResolvedValue({ marked: [], missing: [], failed: ["anillo-luna"] });

      const result = await recordManualSaleAction(
        form({ ...SALE_FORM, itemTitle: "Hacked title" }),
      );

      const message = messageOf((result as { warning: unknown }).warning);
      expect(message).toContain("Anillo Luna");
      expect(message).not.toContain("Hacked");
    });

    it("does NOT warn about a product that no longer exists: there is nothing to mark", async () => {
      markProductsSoldMock.mockResolvedValue({ marked: [], missing: ["anillo-luna"], failed: [] });

      await expect(recordManualSaleAction(form(SALE_FORM))).resolves.toEqual({ ok: true });
      expect(fake.directChildren("sales")).toHaveLength(1);
    });

    it("carries nothing but piece titles: no handle, error or token", async () => {
      markProductsSoldMock.mockResolvedValue({ marked: [], missing: [], failed: ["anillo-luna"] });

      const result = await recordManualSaleAction(form(SALE_FORM));

      expect(JSON.stringify(result)).not.toContain("anillo-luna");
    });
  });

  it("answers a typed failure for a piece that is already sold, and writes and marks nothing", async () => {
    stockCatalog([{ ...DEFAULT_CATALOG[0], availability: "sold" }]);

    const result = await recordManualSaleAction(form(SALE_FORM));

    expect(result).toMatchObject({ ok: false, error: "piece-unavailable" });
    expect(fake.committed).toHaveLength(0);
    expect(markProductsSoldMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("answers a typed failure for a piece the catalog does not have", async () => {
    stockCatalog([]);

    const result = await recordManualSaleAction(form(SALE_FORM));

    expect(result).toMatchObject({ ok: false, error: "piece-not-found" });
    expect(fake.committed).toHaveLength(0);
  });

  it("refuses rows that do not line up, before any data access", async () => {
    const result = await recordManualSaleAction(
      form({
        date: TODAY,
        itemHandle: ["anillo-luna", "aretes-sol"],
        itemPrice: ["1850"],
        itemOption: ["", ""],
      }),
    );

    expect(result).toMatchObject({ ok: false, error: "invalid" });
    expect(getAdminDbMock).not.toHaveBeenCalled();
    expect(getCatalogProductsMock).not.toHaveBeenCalled();
  });

  it("refuses a sale with no pieces", async () => {
    const result = await recordManualSaleAction(form({ date: TODAY }));

    expect(result).toMatchObject({ ok: false, error: "invalid" });
    expect(messageOf(result)).toContain("al menos una pieza");
    expect(getAdminDbMock).not.toHaveBeenCalled();
  });

  it("refuses more pieces than one transaction should carry", async () => {
    const rows = MAX_SALE_ITEMS + 1;
    const result = await recordManualSaleAction(
      form({
        date: TODAY,
        itemHandle: Array.from({ length: rows }, (_, index) => `pieza-${index}`),
        itemPrice: Array.from({ length: rows }, () => "1"),
        itemOption: Array.from({ length: rows }, () => ""),
      }),
    );

    expect(result).toMatchObject({ ok: false, error: "invalid" });
    expect(messageOf(result)).toContain(String(MAX_SALE_ITEMS));
    expect(getAdminDbMock).not.toHaveBeenCalled();
  });

  it("refuses the same piece twice in one sale", async () => {
    const result = await recordManualSaleAction(
      form({
        date: TODAY,
        itemHandle: ["anillo-luna", "anillo-luna"],
        itemPrice: ["1", "1"],
        itemOption: ["", ""],
      }),
    );

    expect(result).toMatchObject({ ok: false, error: "invalid" });
    expect(messageOf(result)).toContain("repetirse");
    expect(getAdminDbMock).not.toHaveBeenCalled();
  });

  it.each([
    ["three decimals in a price", { itemPrice: "12.345" }, "Precio"],
    ["a negative price", { itemPrice: "-5" }, "Precio"],
    ["scientific notation as a price", { itemPrice: "1e3" }, "Precio"],
    ["a blank price", { itemPrice: "" }, "Precio"],
    ["more than the ceiling", { itemPrice: "10000001" }, "Precio"],
    ["a piece that addresses another path", { itemHandle: "a/b/c" }, "Pieza"],
    ["no piece chosen", { itemHandle: "" }, "Pieza"],
    ["an overlong option", { itemOption: "x".repeat(61) }, "Opción"],
    ["a negative shipping", { shipping: "-1" }, "Envío"],
    ["shipping with three decimals", { shipping: "1.234" }, "Envío"],
    ["shipping above the ceiling", { shipping: "100001" }, "Envío"],
    ["an overlong note", { note: "x".repeat(301) }, "Nota"],
    ["a missing date", { date: "" }, "Fecha"],
    ["an impossible date", { date: "2026-02-30" }, "Fecha"],
    ["a future date", { date: "2999-01-01" }, "Fecha"],
  ])("rejects %s before the database, naming the field", async (_label, patch, label) => {
    const result = await recordManualSaleAction(form({ ...SALE_FORM, ...patch }));

    expect(result).toMatchObject({ ok: false, error: "invalid" });
    expect(messageOf(result)).toContain(label);
    expect(getAdminDbMock).not.toHaveBeenCalled();
    expect(getCatalogProductsMock).not.toHaveBeenCalled();
    expect(markProductsSoldMock).not.toHaveBeenCalled();
  });

  it("treats a shipping field that was not sent like a blank one: nothing was charged", async () => {
    const withoutShipping: Record<string, string> = { ...SALE_FORM };
    delete withoutShipping.shipping;

    await expect(recordManualSaleAction(form(withoutShipping))).resolves.toEqual({ ok: true });

    expect(fake.directChildren("sales")[0].data).toMatchObject({ shipping: 0, total: 185_000 });
  });

  it("accepts today and a past date, a price of 0 and no shipping", async () => {
    await expect(
      recordManualSaleAction(form({ ...SALE_FORM, date: "2025-01-15", itemPrice: "0", shipping: "" })),
    ).resolves.toEqual({ ok: true });

    expect(fake.directChildren("sales")[0].data).toMatchObject({
      subtotal: 0,
      shipping: 0,
      total: 0,
    });
  });

  it("holds no customer data, whatever extra fields a request carries", async () => {
    await recordManualSaleAction(
      form({
        ...SALE_FORM,
        customerEmail: "ana@example.com",
        customerName: "Ana Pérez",
        phone: "+525512345678",
        address: "Calle 1",
      }),
    );

    const [sale] = fake.directChildren("sales");
    expect(JSON.stringify(sale.data)).not.toMatch(/ana@example|Pérez|5512345678|Calle 1/);
    expect(Object.keys(sale.data).sort()).toEqual(
      [
        "actor",
        "costOfGoods",
        "costPending",
        "createdAt",
        "currency",
        "date",
        "items",
        "note",
        "shipping",
        "source",
        "status",
        "subtotal",
        "total",
      ].sort(),
    );
  });
});

describe("voidSaleAction", () => {
  it("voids a manual sale, keeps it on record and audits it with the admin's uid", async () => {
    seedSale("sale1");

    const result = await voidSaleAction(form({ saleId: "sale1" }));

    expect(result).toEqual({ ok: true });
    expect(fake.get("sales/sale1")).toMatchObject({ status: "void", subtotal: 185_000 });
    expect(fake.opsMatching(/^sales\//, "delete")).toHaveLength(0);
    const [audit] = fake.directChildren("auditLog");
    expect(audit.data).toMatchObject({
      actor: ADMIN.uid,
      action: "sale.void",
      entity: "sale",
      entityId: "sale1",
    });
  });

  it("never touches the store: the piece is put back on sale in Studio, on purpose", async () => {
    seedSale("sale1");

    await voidSaleAction(form({ saleId: "sale1" }));

    expect(markProductsSoldMock).not.toHaveBeenCalled();
    expect(getCatalogProductsMock).not.toHaveBeenCalled();
  });

  it("answers a typed failure for a LIVE Stripe sale and changes nothing", async () => {
    seedSale("stripe_cs_live_1", {
      source: "stripe",
      livemode: true,
      stripeSessionId: "cs_live_1",
    });

    const result = await voidSaleAction(form({ saleId: "stripe_cs_live_1" }));

    expect(result).toMatchObject({ ok: false, error: "sale-not-voidable" });
    expect(messageOf(result)).toContain("manuales y las de prueba");
    expect(fake.get("sales/stripe_cs_live_1")).toMatchObject({ status: "active" });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("voids a Stripe sale made in TEST mode, keeping it on record and auditing it", async () => {
    seedSale("stripe_cs_test_1", {
      source: "stripe",
      livemode: false,
      stripeSessionId: "cs_test_1",
    });

    const result = await voidSaleAction(form({ saleId: "stripe_cs_test_1" }));

    expect(result).toEqual({ ok: true });
    expect(fake.get("sales/stripe_cs_test_1")).toMatchObject({ status: "void", subtotal: 185_000 });
    expect(fake.opsMatching(/^sales\//, "delete")).toHaveLength(0);
    const [audit] = fake.directChildren("auditLog");
    expect(audit.data).toMatchObject({
      actor: ADMIN.uid,
      action: "sale.void",
      entityId: "stripe_cs_test_1",
    });
    expect(revalidatePathMock).toHaveBeenCalled();
  });

  it("voids an older Stripe sale, from before the livemode field, when its session id is a test one", async () => {
    seedSale("stripe_cs_test_old", { source: "stripe", stripeSessionId: "cs_test_old" });

    await expect(voidSaleAction(form({ saleId: "stripe_cs_test_old" }))).resolves.toEqual({
      ok: true,
    });
    expect(fake.get("sales/stripe_cs_test_old")).toMatchObject({ status: "void" });
  });

  it("answers a typed failure for a sale that does not exist", async () => {
    const result = await voidSaleAction(form({ saleId: "ghost" }));

    expect(result).toMatchObject({ ok: false, error: "sale-not-found" });
  });

  it("succeeds quietly when the sale is already void", async () => {
    seedSale("sale1", { status: "void" });

    await expect(voidSaleAction(form({ saleId: "sale1" }))).resolves.toEqual({ ok: true });
    expect(fake.committed).toHaveLength(0);
  });

  it.each([
    ["a missing id", {}],
    ["a blank id", { saleId: "" }],
    ["an id that addresses another path", { saleId: "a/b/c" }],
    ["a parent escape", { saleId: "../auditLog" }],
    ["an overlong id", { saleId: "x".repeat(129) }],
  ])("rejects %s before the database", async (_label, fields) => {
    const result = await voidSaleAction(form(fields));

    expect(result).toMatchObject({ ok: false, error: "invalid" });
    expect(messageOf(result)).toContain("Venta");
    expect(getAdminDbMock).not.toHaveBeenCalled();
  });
});

describe("refreshSaleFeeAction", () => {
  const SALE_ID = "stripe_cs_live_a1B2c3";

  it("stores Stripe's fee and net on the pending sale, audits it with the admin's uid, and refreshes the pages", async () => {
    seedPendingStripeSale(SALE_ID);

    const result = await refreshSaleFeeAction(form({ saleId: SALE_ID }));

    expect(result).toEqual({ ok: true });
    expect(fake.get(`sales/${SALE_ID}`)).toMatchObject({
      stripeFee: 7_540,
      stripeNet: 192_460,
      feePending: false,
      // Nothing else about the sale changes.
      status: "active",
      subtotal: 185_000,
      livemode: true,
    });
    const [audit] = fake.directChildren("auditLog");
    expect(audit.data).toMatchObject({
      actor: ADMIN.uid,
      action: "sale.fee-refresh",
      entity: "sale",
      entityId: SALE_ID,
    });
    expect(JSON.stringify(audit.data)).not.toContain("7540");
    expect(revalidatePathMock.mock.calls.map(([path]) => path).sort()).toEqual([
      "/admin/piezas",
      "/admin/ventas",
    ]);
  });

  it("asks Stripe about the session id STORED on the sale, never one that came with the request", async () => {
    seedPendingStripeSale(SALE_ID);

    await refreshSaleFeeAction(form({ saleId: SALE_ID, sessionId: "cs_live_somebody_elses" }));

    expect(fetchStripeFeesMock).toHaveBeenCalledTimes(1);
    expect(fetchStripeFeesMock).toHaveBeenCalledWith("cs_live_a1B2c3");
  });

  it("answers a typed, retryable failure when Stripe cannot give the fee yet, and changes nothing", async () => {
    seedPendingStripeSale(SALE_ID);
    fetchStripeFeesMock.mockResolvedValue(null);

    const result = await refreshSaleFeeAction(form({ saleId: SALE_ID }));

    expect(result).toMatchObject({ ok: false, error: "fee-unavailable" });
    expect(messageOf(result)).toContain("Inténtalo de nuevo");
    expect(fake.committed).toHaveLength(0);
    expect(fake.get(`sales/${SALE_ID}`)).toMatchObject({ feePending: true });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("answers a typed failure for a manual sale, which has no Stripe fee to read", async () => {
    seedSale("sale1");

    const result = await refreshSaleFeeAction(form({ saleId: "sale1" }));

    expect(result).toMatchObject({ ok: false, error: "fee-not-refreshable" });
    expect(fetchStripeFeesMock).not.toHaveBeenCalled();
    expect(fake.committed).toHaveLength(0);
  });

  it("succeeds quietly, without asking Stripe or writing, when the fee is already known", async () => {
    seedPendingStripeSale(SALE_ID, { stripeFee: 5_000, stripeNet: 195_000, feePending: false });

    await expect(refreshSaleFeeAction(form({ saleId: SALE_ID }))).resolves.toEqual({ ok: true });

    expect(fetchStripeFeesMock).not.toHaveBeenCalled();
    expect(fake.committed).toHaveLength(0);
    expect(fake.get(`sales/${SALE_ID}`)).toMatchObject({ stripeFee: 5_000 });
  });

  it("answers a typed failure for a sale that does not exist", async () => {
    const result = await refreshSaleFeeAction(form({ saleId: "ghost" }));

    expect(result).toMatchObject({ ok: false, error: "sale-not-found" });
    expect(fetchStripeFeesMock).not.toHaveBeenCalled();
  });

  it.each([
    ["a missing id", {}],
    ["a blank id", { saleId: "" }],
    ["an id that addresses another path", { saleId: "a/b/c" }],
    ["a parent escape", { saleId: "../auditLog" }],
    ["an overlong id", { saleId: "x".repeat(129) }],
  ])("rejects %s before the database, and before Stripe", async (_label, fields) => {
    const result = await refreshSaleFeeAction(form(fields));

    expect(result).toMatchObject({ ok: false, error: "invalid" });
    expect(messageOf(result)).toContain("Venta");
    expect(getAdminDbMock).not.toHaveBeenCalled();
    expect(fetchStripeFeesMock).not.toHaveBeenCalled();
  });
});
