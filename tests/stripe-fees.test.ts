import { beforeEach, describe, expect, it, vi } from "vitest";

// fetchStripeFees is the one place that reads a payment's fee from Stripe: the
// webhook uses it when it records a sale (tests/stripe-sale-recording.test.ts)
// and the "Actualizar comisión" action when it refreshes one
// (tests/admin-sales-data.test.ts). Stripe is mocked at its client.
vi.mock("server-only", () => ({}));

const retrieveMock = vi.fn();
const getStripeClientMock = vi.fn();
vi.mock("@/lib/commerce/stripe/client", () => ({
  getStripeClient: () => getStripeClientMock(),
}));

import { fetchStripeFees } from "@/lib/admin/data/stripe-fees";

const SESSION_ID = "cs_live_a1B2c3D4e5F6";

function answer(transaction: unknown) {
  return { id: SESSION_ID, payment_intent: { latest_charge: { balance_transaction: transaction } } };
}

beforeEach(() => {
  vi.resetAllMocks();
  getStripeClientMock.mockReturnValue({
    checkout: { sessions: { retrieve: retrieveMock } },
  });
  retrieveMock.mockResolvedValue(answer({ fee: 7_540, net: 192_460, currency: "mxn" }));
});

describe("fetchStripeFees", () => {
  it("returns Stripe's fee (IVA on the fee included) and the net, in integer centavos", async () => {
    await expect(fetchStripeFees(SESSION_ID)).resolves.toEqual({ fee: 7_540, net: 192_460 });
  });

  it("retrieves the session with the balance transaction expanded, in one bounded call", async () => {
    await fetchStripeFees(SESSION_ID);

    expect(retrieveMock).toHaveBeenCalledTimes(1);
    expect(retrieveMock).toHaveBeenCalledWith(
      SESSION_ID,
      { expand: ["payment_intent.latest_charge.balance_transaction"] },
      { timeout: 4_000, maxNetworkRetries: 0 },
    );
  });

  it("accepts a fee of zero", async () => {
    retrieveMock.mockResolvedValue(answer({ fee: 0, net: 100_000, currency: "mxn" }));

    await expect(fetchStripeFees(SESSION_ID)).resolves.toEqual({ fee: 0, net: 100_000 });
  });

  it.each([
    ["Stripe rejects the call", () => retrieveMock.mockRejectedValue(new Error("StripeConnectionError"))],
    ["the session is unknown to this account's keys", () =>
      retrieveMock.mockRejectedValue(Object.assign(new Error("No such checkout.session"), { statusCode: 404 }))],
    ["Stripe is not configured", () => getStripeClientMock.mockReturnValue(undefined)],
    ["the client cannot even be built", () => getStripeClientMock.mockImplementation(() => {
      throw new Error("bad key");
    })],
    ["the payment intent is not expanded", () => retrieveMock.mockResolvedValue({ id: SESSION_ID, payment_intent: "pi_1" })],
    ["there is no payment intent", () => retrieveMock.mockResolvedValue({ id: SESSION_ID, payment_intent: null })],
    ["the charge is not expanded", () => retrieveMock.mockResolvedValue({ payment_intent: { latest_charge: "ch_1" } })],
    ["there is no charge", () => retrieveMock.mockResolvedValue({ payment_intent: { latest_charge: null } })],
    ["the balance transaction is not expanded", () => retrieveMock.mockResolvedValue(answer("txn_1"))],
    ["the balance transaction is not settled", () => retrieveMock.mockResolvedValue(answer(null))],
    ["the answer is empty", () => retrieveMock.mockResolvedValue(undefined)],
    ["the settlement currency is not MXN", () => retrieveMock.mockResolvedValue(answer({ fee: 400, net: 9_600, currency: "usd" }))],
    ["the currency is missing", () => retrieveMock.mockResolvedValue(answer({ fee: 400, net: 9_600 }))],
    ["the fee is negative", () => retrieveMock.mockResolvedValue(answer({ fee: -1, net: 1, currency: "mxn" }))],
    ["the fee is fractional", () => retrieveMock.mockResolvedValue(answer({ fee: 1.5, net: 100, currency: "mxn" }))],
    ["the fee is text", () => retrieveMock.mockResolvedValue(answer({ fee: "7540", net: 100, currency: "mxn" }))],
    ["the net is missing", () => retrieveMock.mockResolvedValue(answer({ fee: 100, currency: "mxn" }))],
    ["the net is not a safe integer", () => retrieveMock.mockResolvedValue(answer({ fee: 100, net: Number.NaN, currency: "mxn" }))],
  ])("answers null, and never throws, when %s", async (_label, arrange) => {
    arrange();

    await expect(fetchStripeFees(SESSION_ID)).resolves.toBeNull();
  });

  it.each([
    "",
    "x",
    "cs_",
    "pi_123",
    "cs_test_../../x",
    "cs_test_a b",
    "cs_test_<script>",
    `cs_${"a".repeat(201)}`,
  ])("does not even call Stripe for the malformed session id %j", async (id) => {
    await expect(fetchStripeFees(id)).resolves.toBeNull();

    expect(getStripeClientMock).not.toHaveBeenCalled();
    expect(retrieveMock).not.toHaveBeenCalled();
  });

  it("logs nothing, even when the call fails with a message that could echo the request", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
    retrieveMock.mockRejectedValue(new Error(`Invalid API Key provided: sk_live_secret ${SESSION_ID}`));

    await fetchStripeFees(SESSION_ID);

    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });
});
