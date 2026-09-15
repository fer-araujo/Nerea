import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// getStripeClient and markProductsSold are both mocked so this file tests
// exactly the route handler's own branching (signature gate -> event-type
// dispatch -> markProductsSold), decoupled from the real Stripe SDK's HMAC
// verification and the real Sanity write path — those are each other
// modules' own concerns (see tests/mark-sold.test.ts).
const getStripeClientMock = vi.fn();
const constructEventMock = vi.fn();
const markProductsSoldMock = vi.fn();

vi.mock("@/lib/commerce/stripe/client", () => ({
  getStripeClient: () => getStripeClientMock(),
}));

vi.mock("@/lib/commerce/sanity/mark-sold", () => ({
  markProductsSold: (...args: unknown[]) => markProductsSoldMock(...args),
}));

import { POST } from "@/app/api/stripe/webhook/route";

const ORIGINAL_ENV = { ...process.env };

function makeRequest(body: string, headers: Record<string, string> = {}): Request {
  return new Request("https://nerea.example/api/stripe/webhook", {
    method: "POST",
    headers,
    body,
  });
}

beforeEach(() => {
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_secret";
  getStripeClientMock.mockReturnValue({
    webhooks: { constructEvent: constructEventMock },
  });
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.clearAllMocks();
});

describe("POST /api/stripe/webhook — signature gate", () => {
  it("returns 400 and never calls markProductsSold when the stripe-signature header is missing", async () => {
    const response = await POST(makeRequest("{}"));

    expect(response.status).toBe(400);
    expect(constructEventMock).not.toHaveBeenCalled();
    expect(markProductsSoldMock).not.toHaveBeenCalled();
  });

  it("returns 400 and never processes when STRIPE_WEBHOOK_SECRET is unset", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;

    const response = await POST(
      makeRequest("{}", { "stripe-signature": "sig_test" }),
    );

    expect(response.status).toBe(400);
    expect(constructEventMock).not.toHaveBeenCalled();
    expect(markProductsSoldMock).not.toHaveBeenCalled();
  });

  it("returns 400 and never calls markProductsSold when Stripe is not configured", async () => {
    getStripeClientMock.mockReturnValueOnce(undefined);

    const response = await POST(
      makeRequest("{}", { "stripe-signature": "sig_test" }),
    );

    expect(response.status).toBe(400);
    expect(markProductsSoldMock).not.toHaveBeenCalled();
  });

  it("returns 400 and never calls markProductsSold when signature verification throws", async () => {
    constructEventMock.mockImplementation(() => {
      throw new Error(
        "No signatures found matching the expected signature for payload",
      );
    });

    const response = await POST(
      makeRequest("{}", { "stripe-signature": "bad_sig" }),
    );

    expect(response.status).toBe(400);
    expect(markProductsSoldMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/stripe/webhook — checkout.session.completed", () => {
  it("marks every comma-joined handle in metadata sold and returns 200", async () => {
    constructEventMock.mockReturnValue({
      type: "checkout.session.completed",
      data: {
        object: {
          metadata: { handles: "anillo-plata,aretes-luna" },
        },
      },
    });

    const response = await POST(
      makeRequest("{}", { "stripe-signature": "sig_test" }),
    );

    expect(response.status).toBe(200);
    expect(markProductsSoldMock).toHaveBeenCalledWith([
      "anillo-plata",
      "aretes-luna",
    ]);
  });

  it("calls markProductsSold with an empty array when metadata.handles is missing", async () => {
    constructEventMock.mockReturnValue({
      type: "checkout.session.completed",
      data: { object: { metadata: null } },
    });

    const response = await POST(
      makeRequest("{}", { "stripe-signature": "sig_test" }),
    );

    expect(response.status).toBe(200);
    expect(markProductsSoldMock).toHaveBeenCalledWith([]);
  });

  it("still returns 200 without throwing when markProductsSold itself rejects unexpectedly", async () => {
    constructEventMock.mockReturnValue({
      type: "checkout.session.completed",
      data: { object: { metadata: { handles: "anillo-plata" } } },
    });
    markProductsSoldMock.mockRejectedValueOnce(new Error("unexpected"));

    const response = await POST(
      makeRequest("{}", { "stripe-signature": "sig_test" }),
    );

    expect(response.status).toBe(200);
  });
});

describe("POST /api/stripe/webhook — unrelated event types", () => {
  it("returns 200 and never writes for an event type this endpoint doesn't handle", async () => {
    constructEventMock.mockReturnValue({
      type: "payment_intent.succeeded",
      data: { object: {} },
    });

    const response = await POST(
      makeRequest("{}", { "stripe-signature": "sig_test" }),
    );

    expect(response.status).toBe(200);
    expect(markProductsSoldMock).not.toHaveBeenCalled();
  });
});
