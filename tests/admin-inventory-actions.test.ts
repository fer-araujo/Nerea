import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  FakeFirestore,
  FakeTimestamp,
  MOVEMENT_PATH,
  type FakeOp,
} from "@/tests/helpers/fake-firestore";

// The four inventory Server Actions run against the REAL zod schemas, domain
// rules and data layer, with Firestore faked at the very edge (getAdminDb), so
// "never touches Firestore before authorizing" and "rejects bad input before
// the database" are asserted where they matter: at the database boundary.
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

import { registerCastingAction } from "@/app/admin/(panel)/calculadora/actions";
import { adjustStockAction, createMaterialAction } from "@/app/admin/(panel)/inventario/actions";
import { recordPurchaseAction } from "@/app/admin/(panel)/inversiones/actions";
import { mexicoTodayIso } from "@/lib/admin/domain/periods";
import { MAX_PURCHASE_ITEMS } from "@/lib/admin/domain/inventory";

const ADMIN = { uid: "uid-admin-1", email: "admin@example.com" };
const TODAY = mexicoTodayIso();
const LEDGER_PATHS = ["/admin/calculadora", "/admin/inventario", "/admin/inversiones"];

function form(fields: Record<string, string | string[] | Blob>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      data.append(key, item);
    }
  }
  return data;
}

function seedMaterial(id: string, overrides: Record<string, unknown> = {}) {
  fake.seed(`materials/${id}`, {
    name: id,
    kind: "fine_silver",
    unit: "g",
    stock: 100,
    avgCost: 1500,
    createdAt: new FakeTimestamp(new Date("2026-09-01T12:00:00Z")),
    updatedAt: new FakeTimestamp(new Date("2026-09-01T12:00:00Z")),
    ...overrides,
  });
}

function seedShelf() {
  seedMaterial("m1", { name: "Plata fina", kind: "fine_silver", stock: 100, avgCost: 1500 });
  seedMaterial("fine", { name: "Oro fino", kind: "fine_gold", stock: 100, avgCost: 150_000 });
  seedMaterial("alloy", { name: "Liga 14k", kind: "alloy", stock: 50, avgCost: 8000 });
}

function dataOf(op: FakeOp | undefined): Record<string, unknown> {
  if (!op || op.kind === "delete") {
    throw new Error("expected a write operation");
  }
  return op.data;
}

const GOLD_FORM = {
  metal: "gold-14k",
  color: "yellow",
  waxGrams: "5",
  density: "13.07",
  fineness: "0.585",
  allowancePercent: "10",
  recycledGrams: "",
  fineMaterialId: "fine",
  alloyMaterialId: "alloy",
  date: TODAY,
  note: "Anillo de prueba",
};

beforeEach(() => {
  vi.resetAllMocks();
  fake = new FakeFirestore();
  getAdminDbMock.mockReturnValue(fake);
  requireAdminMock.mockResolvedValue(ADMIN);
});

// Every action is held to the same contract.
const ACTIONS: Array<{
  name: string;
  run: (formData: FormData) => Promise<unknown>;
  validForm: () => FormData;
}> = [
  {
    name: "createMaterialAction",
    run: createMaterialAction,
    validForm: () => form({ name: "Plata fina", kind: "fine_silver", unit: "g" }),
  },
  {
    name: "adjustStockAction",
    run: adjustStockAction,
    validForm: () =>
      form({ materialId: "m1", delta: "-1", kind: "adjustment", reason: "Conteo" }),
  },
  {
    name: "recordPurchaseAction",
    run: recordPurchaseAction,
    validForm: () =>
      form({ date: TODAY, itemMaterialId: "m1", itemQty: "1", itemCost: "10" }),
  },
  {
    name: "registerCastingAction",
    run: registerCastingAction,
    validForm: () => form(GOLD_FORM),
  },
];

describe.each(ACTIONS)("$name", ({ run, validForm }) => {
  it("authorizes with requireAdmin BEFORE touching Firestore", async () => {
    seedShelf();

    await expect(run(validForm())).resolves.toEqual({ ok: true });

    expect(requireAdminMock).toHaveBeenCalledTimes(1);
    expect(requireAdminMock.mock.invocationCallOrder[0]).toBeLessThan(
      getAdminDbMock.mock.invocationCallOrder[0],
    );
  });

  it("never touches Firestore, and refreshes nothing, when the caller is not an admin", async () => {
    seedShelf();
    requireAdminMock.mockRejectedValue(new Error("NEXT_REDIRECT /admin/login"));

    await expect(run(validForm())).rejects.toThrow("NEXT_REDIRECT /admin/login");

    expect(getAdminDbMock).not.toHaveBeenCalled();
    expect(fake.committed).toHaveLength(0);
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("refreshes every page that reads the ledger on success", async () => {
    seedShelf();

    await run(validForm());

    expect(revalidatePathMock.mock.calls.map(([path]) => path).sort()).toEqual(
      LEDGER_PATHS,
    );
  });

  it("answers 'unavailable', not success, when Firebase is not configured", async () => {
    getAdminDbMock.mockReturnValue(undefined);

    await expect(run(validForm())).resolves.toMatchObject({
      ok: false,
      error: "unavailable",
    });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("returns a generic failure and leaks nothing when Firestore fails", async () => {
    seedShelf();
    vi.spyOn(fake, "runTransaction").mockRejectedValue(new Error("secret internal detail"));

    const result = await run(validForm());

    expect(result).toMatchObject({ ok: false, error: "failed" });
    expect(JSON.stringify(result)).not.toContain("secret internal detail");
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("refuses a request that is not a FormData, after authorizing and before any data access", async () => {
    await expect(run("not a form" as unknown as FormData)).resolves.toMatchObject({
      ok: false,
      error: "invalid",
    });

    expect(requireAdminMock).toHaveBeenCalledTimes(1);
    expect(getAdminDbMock).not.toHaveBeenCalled();
  });

  it("logs nothing, neither on success nor on failure (a log line could carry amounts)", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
    seedShelf();

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

describe("createMaterialAction", () => {
  it("creates an empty material, trims the name and audits with the admin's uid", async () => {
    const result = await createMaterialAction(
      form({ name: "  Plata fina  ", kind: "fine_silver", unit: "g" }),
    );

    expect(result).toEqual({ ok: true });
    const [material] = fake.directChildren("materials");
    expect(material.data).toMatchObject({
      name: "Plata fina",
      kind: "fine_silver",
      unit: "g",
      stock: 0,
      avgCost: 0,
    });
    const audit = fake.directChildren("auditLog")[0].data;
    expect(audit).toMatchObject({ actor: ADMIN.uid, action: "material.create" });
  });

  it.each([
    ["a missing name", { kind: "fine_silver", unit: "g" }, "Nombre"],
    ["a blank name", { name: "   ", kind: "fine_silver", unit: "g" }, "Nombre"],
    ["an overlong name", { name: "x".repeat(81), kind: "fine_silver", unit: "g" }, "Nombre"],
    ["an unknown kind", { name: "Plata", kind: "platinum", unit: "g" }, "Tipo"],
    ["an unknown unit", { name: "Plata", kind: "fine_silver", unit: "kg" }, "Unidad"],
    ["no fields at all", {}, "Nombre"],
  ])("rejects %s before the database, naming the field", async (_label, fields, label) => {
    const result = await createMaterialAction(form(fields));

    expect(result).toMatchObject({ ok: false, error: "invalid" });
    expect((result as { message: string }).message).toContain(label);
    expect(getAdminDbMock).not.toHaveBeenCalled();
    expect(fake.committed).toHaveLength(0);
  });

  it("treats a file in a text field as missing", async () => {
    const result = await createMaterialAction(
      form({ name: new Blob(["x"]), kind: "fine_silver", unit: "g" }),
    );

    expect(result).toMatchObject({ ok: false, error: "invalid" });
    expect(getAdminDbMock).not.toHaveBeenCalled();
  });
});

describe("adjustStockAction", () => {
  const base = { materialId: "m1", delta: "-2.5", kind: "adjustment", reason: "Conteo físico" };

  it("applies the correction, records who and why, and keeps the average cost", async () => {
    seedShelf();

    const result = await adjustStockAction(form({ ...base, reason: "  Conteo físico  " }));

    expect(result).toEqual({ ok: true });
    expect(fake.get("materials/m1")).toMatchObject({ stock: 97.5, avgCost: 1500 });
    const movement = dataOf(fake.opsMatching(MOVEMENT_PATH, "create")[0]);
    expect(movement).toMatchObject({
      type: "adjustment",
      qty: -2.5,
      note: "Conteo físico",
      actor: ADMIN.uid,
    });
  });

  it("accepts a loss that removes stock", async () => {
    seedShelf();

    await expect(
      adjustStockAction(form({ ...base, kind: "loss", delta: "-1" })),
    ).resolves.toEqual({ ok: true });
    expect(dataOf(fake.opsMatching(MOVEMENT_PATH, "create")[0]).type).toBe("loss");
  });

  it.each([
    ["a non-numeric quantity", { delta: "abc" }, "Cantidad"],
    ["a blank quantity", { delta: "" }, "Cantidad"],
    ["a zero quantity", { delta: "0" }, "0"],
    ["scientific notation", { delta: "1e3" }, "Cantidad"],
    ["three decimals", { delta: "2.555" }, "Cantidad"],
    ["a comma decimal", { delta: "2,5" }, "Cantidad"],
    ["an absurd magnitude", { delta: "9999999999" }, "Cantidad"],
    ["a loss that adds stock", { kind: "loss", delta: "3" }, "merma"],
    ["a reason that is too short", { reason: "ab" }, "Motivo"],
    ["a blank reason", { reason: "   " }, "Motivo"],
    ["an overlong reason", { reason: "x".repeat(201) }, "Motivo"],
    ["an unknown kind", { kind: "gift" }, "Tipo"],
    ["a material id that tries to address another path", { materialId: "a/b/c" }, "Material"],
    ["a missing material", { materialId: "" }, "Material"],
  ])("rejects %s before the database", async (_label, patch, label) => {
    seedShelf();

    const result = await adjustStockAction(form({ ...base, ...patch }));

    expect(result).toMatchObject({ ok: false, error: "invalid" });
    expect((result as { message: string }).message).toContain(label);
    expect(getAdminDbMock).not.toHaveBeenCalled();
    expect(fake.committed).toHaveLength(0);
  });

  it("answers a typed insufficient-stock failure and writes nothing", async () => {
    seedShelf();

    const result = await adjustStockAction(form({ ...base, delta: "-100.01" }));

    expect(result).toMatchObject({ ok: false, error: "insufficient-stock" });
    expect(fake.committed).toHaveLength(0);
    expect(fake.get("materials/m1")).toMatchObject({ stock: 100 });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("answers a typed failure for an unknown material", async () => {
    const result = await adjustStockAction(form({ ...base, materialId: "ghost" }));

    expect(result).toMatchObject({ ok: false, error: "material-not-found" });
  });

  it("answers a typed failure for a fractional number of pieces", async () => {
    seedMaterial("stones", { kind: "stone", unit: "pz", stock: 10, avgCost: 500 });

    const result = await adjustStockAction(
      form({ ...base, materialId: "stones", delta: "-1.5" }),
    );

    expect(result).toMatchObject({ ok: false, error: "invalid-quantity" });
    expect(fake.committed).toHaveLength(0);
  });
});

describe("recordPurchaseAction", () => {
  const line = { itemMaterialId: "m1", itemQty: "5", itemCost: "90.00" };
  const base = { date: TODAY, ...line };

  it("records a multi-line purchase: costs become centavos, names come from the database", async () => {
    seedMaterial("m1", { name: "Plata fina", stock: 10, avgCost: 1000 });
    seedMaterial("m3", { name: "Liga", kind: "alloy", stock: 0, avgCost: 0 });

    const result = await recordPurchaseAction(
      form({
        date: TODAY,
        supplier: "  Proveedor Uno ",
        note: "Factura 12",
        itemMaterialId: ["m1", "m3"],
        itemQty: ["5", "20"],
        itemCost: ["90.00", "20"],
      }),
    );

    expect(result).toEqual({ ok: true });
    expect(fake.get("materials/m1")).toMatchObject({ stock: 15, avgCost: 1267 });
    expect(fake.get("materials/m3")).toMatchObject({ stock: 20, avgCost: 100 });

    const receipt = fake.directChildren("purchases")[0].data;
    expect(receipt).toMatchObject({
      supplier: "Proveedor Uno",
      note: "Factura 12",
      totalCost: 11_000,
      actor: ADMIN.uid,
      items: [
        { materialId: "m1", materialName: "Plata fina", qty: 5, totalCost: 9000 },
        { materialId: "m3", materialName: "Liga", qty: 20, totalCost: 2000 },
      ],
    });
  });

  it("records the opening inventory as a purchase called 'Inventario inicial'", async () => {
    seedMaterial("m1", { stock: 0, avgCost: 0 });

    await expect(
      recordPurchaseAction(form({ ...base, supplier: "Inventario inicial" })),
    ).resolves.toEqual({ ok: true });

    expect(fake.directChildren("purchases")[0].data.supplier).toBe("Inventario inicial");
    expect(fake.get("materials/m1")).toMatchObject({ stock: 5, avgCost: 1800 });
  });

  it("accepts today and a past date", async () => {
    seedMaterial("m1");

    await expect(recordPurchaseAction(form({ ...base, date: TODAY }))).resolves.toEqual({
      ok: true,
    });
    await expect(
      recordPurchaseAction(form({ ...base, date: "2025-01-15" })),
    ).resolves.toEqual({ ok: true });
  });

  it("refuses rows that do not line up, before the database", async () => {
    const result = await recordPurchaseAction(
      form({
        date: TODAY,
        itemMaterialId: ["m1", "m3"],
        itemQty: ["5"],
        itemCost: ["90", "20"],
      }),
    );

    expect(result).toMatchObject({ ok: false, error: "invalid" });
    expect(getAdminDbMock).not.toHaveBeenCalled();
  });

  it("refuses a purchase with no rows", async () => {
    const result = await recordPurchaseAction(form({ date: TODAY }));

    expect(result).toMatchObject({ ok: false, error: "invalid" });
    expect((result as { message: string }).message).toContain("al menos un material");
    expect(getAdminDbMock).not.toHaveBeenCalled();
  });

  it("refuses more rows than one transaction should carry", async () => {
    const rows = MAX_PURCHASE_ITEMS + 1;
    const result = await recordPurchaseAction(
      form({
        date: TODAY,
        itemMaterialId: Array.from({ length: rows }, () => "m1"),
        itemQty: Array.from({ length: rows }, () => "1"),
        itemCost: Array.from({ length: rows }, () => "1"),
      }),
    );

    expect(result).toMatchObject({ ok: false, error: "invalid" });
    expect((result as { message: string }).message).toContain(String(MAX_PURCHASE_ITEMS));
    expect(getAdminDbMock).not.toHaveBeenCalled();
  });

  it.each([
    ["three decimals", "12.345"],
    ["a negative amount", "-5"],
    ["scientific notation", "1e3"],
    ["text", "abc"],
    ["a blank amount", ""],
    ["a comma decimal", "12,50"],
    ["nine digits", "100000000"],
    ["more than the ceiling", "10000001"],
  ])("rejects a cost with %s", async (_label, cost) => {
    seedMaterial("m1");

    const result = await recordPurchaseAction(form({ ...base, itemCost: cost }));

    expect(result).toMatchObject({ ok: false, error: "invalid" });
    expect((result as { message: string }).message).toContain("Costo");
    expect(getAdminDbMock).not.toHaveBeenCalled();
  });

  it("accepts a zero cost (a gift) and the largest allowed amount", async () => {
    seedMaterial("m1");

    await expect(
      recordPurchaseAction(form({ ...base, itemCost: "0" })),
    ).resolves.toEqual({ ok: true });
    await expect(
      recordPurchaseAction(form({ ...base, itemCost: "10000000" })),
    ).resolves.toEqual({ ok: true });
  });

  it.each([
    ["zero", "0"],
    ["negative", "-1"],
    ["three decimals", "1.234"],
    ["text", "abc"],
    ["blank", ""],
    ["scientific notation", "1e3"],
  ])("rejects a %s quantity", async (_label, qty) => {
    seedMaterial("m1");

    const result = await recordPurchaseAction(form({ ...base, itemQty: qty }));

    expect(result).toMatchObject({ ok: false, error: "invalid" });
    expect((result as { message: string }).message).toContain("Cantidad");
    expect(getAdminDbMock).not.toHaveBeenCalled();
  });

  it.each([
    ["a missing date", undefined],
    ["a blank date", ""],
    ["an impossible date", "2026-02-30"],
    ["free text", "mañana"],
    ["a short day", "2026-10-2"],
    ["a future date", "2999-01-01"],
  ])("rejects %s", async (_label, date) => {
    seedMaterial("m1");
    const fields: Record<string, string | string[]> = { ...line };
    if (date !== undefined) {
      fields.date = date;
    }

    const result = await recordPurchaseAction(form(fields));

    expect(result).toMatchObject({ ok: false, error: "invalid" });
    expect((result as { message: string }).message).toContain("Fecha");
    expect(getAdminDbMock).not.toHaveBeenCalled();
  });

  it("rejects an overlong supplier or note", async () => {
    seedMaterial("m1");

    await expect(
      recordPurchaseAction(form({ ...base, supplier: "x".repeat(121) })),
    ).resolves.toMatchObject({ ok: false, error: "invalid" });
    await expect(
      recordPurchaseAction(form({ ...base, note: "x".repeat(301) })),
    ).resolves.toMatchObject({ ok: false, error: "invalid" });
    expect(getAdminDbMock).not.toHaveBeenCalled();
  });

  it("rejects a material id that tries to address another path, and a file as a value", async () => {
    await expect(
      recordPurchaseAction(form({ ...base, itemMaterialId: "a/b/c" })),
    ).resolves.toMatchObject({ ok: false, error: "invalid" });
    await expect(
      recordPurchaseAction(form({ ...base, itemQty: new Blob(["5"]) })),
    ).resolves.toMatchObject({ ok: false, error: "invalid" });
    expect(getAdminDbMock).not.toHaveBeenCalled();
  });

  it("answers typed failures from the ledger and writes nothing", async () => {
    seedMaterial("stones", { kind: "stone", unit: "pz", stock: 0, avgCost: 0 });

    await expect(
      recordPurchaseAction(form({ ...base, itemMaterialId: "ghost" })),
    ).resolves.toMatchObject({ ok: false, error: "material-not-found" });
    await expect(
      recordPurchaseAction(form({ ...base, itemMaterialId: "stones", itemQty: "1.5" })),
    ).resolves.toMatchObject({ ok: false, error: "invalid-quantity" });
    expect(fake.committed).toHaveLength(0);
  });
});

describe("registerCastingAction", () => {
  it("registers the required vector: 5 g of 14k yellow wax consumes 42.05 g fine + 29.84 g alloy", async () => {
    seedShelf();

    const result = await registerCastingAction(form(GOLD_FORM));

    expect(result).toEqual({ ok: true });
    expect(fake.get("materials/fine")).toMatchObject({ stock: 57.95 });
    expect(fake.get("materials/alloy")).toMatchObject({ stock: 20.16 });

    const casting = fake.directChildren("castings")[0].data;
    expect(casting).toMatchObject({
      inputs: { metal: "gold-14k", color: "yellow", allowance: 0.1, recycledGrams: 0 },
      outputs: { metalGrams: 71.89, fineGrams: 42.05, alloyGrams: 29.84 },
      note: "Anillo de prueba",
      actor: ADMIN.uid,
    });
  });

  it("converts the typed percentage into a fraction", async () => {
    seedShelf();

    await registerCastingAction(form({ ...GOLD_FORM, allowancePercent: "12.5" }));

    expect(fake.directChildren("castings")[0].data.inputs).toMatchObject({
      allowance: 0.125,
    });
  });

  it("ignores a stale color on silver and needs no color for it", async () => {
    seedShelf();
    seedMaterial("silver", { kind: "fine_silver", stock: 200, avgCost: 1500 });
    seedMaterial("copper", { kind: "alloy", stock: 50, avgCost: 400 });

    const result = await registerCastingAction(
      form({
        ...GOLD_FORM,
        metal: "silver-925",
        color: "red",
        density: "10.4",
        fineness: "0.925",
        fineMaterialId: "silver",
        alloyMaterialId: "copper",
      }),
    );

    expect(result).toEqual({ ok: true });
    expect(fake.directChildren("castings")[0].data.inputs).not.toHaveProperty("color");
  });

  it("treats a blank recycled field as none and a blank alloy pick as not chosen", async () => {
    seedMaterial("fine", { kind: "fine_gold", stock: 100, avgCost: 150_000 });

    const result = await registerCastingAction(
      form({
        ...GOLD_FORM,
        density: "10",
        fineness: "1",
        allowancePercent: "0",
        recycledGrams: "",
        alloyMaterialId: "",
      }),
    );

    expect(result).toEqual({ ok: true });
    expect(fake.get("materials/fine")).toMatchObject({ stock: 50 });
  });

  it("requires a color for gold", async () => {
    seedShelf();

    const result = await registerCastingAction(form({ ...GOLD_FORM, color: "" }));

    expect(result).toMatchObject({ ok: false, error: "invalid" });
    expect((result as { message: string }).message).toContain("Color");
    expect(getAdminDbMock).not.toHaveBeenCalled();
  });

  it.each([
    ["an unknown metal", { metal: "gold-24k" }, "Metal"],
    ["an unknown color", { color: "green" }, "Color"],
    ["zero wax", { waxGrams: "0" }, "Peso de cera"],
    ["negative wax", { waxGrams: "-1" }, "Peso de cera"],
    ["text as wax", { waxGrams: "abc" }, "Peso de cera"],
    ["blank wax", { waxGrams: "" }, "Peso de cera"],
    ["scientific notation as wax", { waxGrams: "1e3" }, "Peso de cera"],
    ["absurdly heavy wax", { waxGrams: "10001" }, "Peso de cera"],
    ["a zero density", { density: "0" }, "Densidad"],
    ["an absurd density", { density: "31" }, "Densidad"],
    ["a zero fineness", { fineness: "0" }, "Ley"],
    ["a fineness above 1", { fineness: "1.5" }, "Ley"],
    ["an allowance above 100 %", { allowancePercent: "101" }, "Bebedero"],
    ["a negative allowance", { allowancePercent: "-1" }, "Bebedero"],
    ["blank allowance", { allowancePercent: "" }, "Bebedero"],
    ["text as recycled metal", { recycledGrams: "lots" }, "Metal reciclado"],
    ["negative recycled metal", { recycledGrams: "-2" }, "Metal reciclado"],
    ["an impossible date", { date: "2026-02-30" }, "Fecha"],
    ["a future date", { date: "2999-01-01" }, "Fecha"],
    ["an overlong note", { note: "x".repeat(301) }, "Nota"],
    ["a fine pick that addresses another path", { fineMaterialId: "a/b/c" }, "Material fino"],
    ["an alloy pick that addresses another path", { alloyMaterialId: "../x" }, "Liga"],
  ])("rejects %s before the database", async (_label, patch, label) => {
    seedShelf();

    const result = await registerCastingAction(form({ ...GOLD_FORM, ...patch }));

    expect(result).toMatchObject({ ok: false, error: "invalid" });
    expect((result as { message: string }).message).toContain(label);
    expect(getAdminDbMock).not.toHaveBeenCalled();
    expect(fake.committed).toHaveLength(0);
  });

  it("says in plain Spanish that recycled metal cannot exceed the metal, before any data access", async () => {
    seedShelf();

    const result = await registerCastingAction(
      form({ ...GOLD_FORM, recycledGrams: "500" }),
    );

    expect(result).toEqual({
      ok: false,
      error: "invalid",
      message: "El metal reciclado no puede ser mayor que el metal total.",
    });
    expect(getAdminDbMock).not.toHaveBeenCalled();
  });

  it("answers a typed insufficient-stock failure and writes nothing", async () => {
    seedShelf();
    seedMaterial("fine", { kind: "fine_gold", stock: 10, avgCost: 150_000 });

    const result = await registerCastingAction(form(GOLD_FORM));

    expect(result).toMatchObject({ ok: false, error: "insufficient-stock" });
    expect(fake.committed).toHaveLength(0);
    expect(fake.get("materials/alloy")).toMatchObject({ stock: 50 });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("answers a typed failure when a pick is the wrong kind of material", async () => {
    seedShelf();

    const result = await registerCastingAction(
      form({ ...GOLD_FORM, fineMaterialId: "m1" }), // fine SILVER for a gold pour
    );

    expect(result).toMatchObject({ ok: false, error: "invalid-material" });
    expect(fake.committed).toHaveLength(0);
  });

  it("answers a typed failure when a pick does not exist", async () => {
    seedShelf();

    const result = await registerCastingAction(
      form({ ...GOLD_FORM, alloyMaterialId: "ghost" }),
    );

    expect(result).toMatchObject({ ok: false, error: "material-not-found" });
  });
});
