// @vitest-environment jsdom
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

// The cart and the router are stand-ins: this file covers WHEN the island
// empties the cart. What `clear()` does to the stored cart is in the cart
// context itself, and how the success URL is built is in
// tests/cart-checkout-action.test.ts.
const clearMock = vi.fn();
vi.mock("@/lib/cart/cart-context", () => ({
  useCart: () => ({ clear: clearMock }),
}));

let search = "";
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search),
}));

import { ClearCartOnSuccess } from "@/components/checkout/ClearCartOnSuccess";
import {
  isCheckoutSessionId,
  withSessionIdPlaceholder,
} from "@/lib/cart/checkout-session";

const SESSION_ID = "cs_test_a1B2c3D4e5F6g7H8i9J0";

beforeEach(() => {
  vi.resetAllMocks();
  search = "";
});

describe("ClearCartOnSuccess", () => {
  it("empties the cart once when Stripe's session id is in the URL", () => {
    search = `session_id=${SESSION_ID}`;

    render(<ClearCartOnSuccess />);

    expect(clearMock).toHaveBeenCalledTimes(1);
  });

  it("accepts a live-mode session id too", () => {
    search = "session_id=cs_live_a1B2c3D4e5F6g7H8i9J0";

    render(<ClearCartOnSuccess />);

    expect(clearMock).toHaveBeenCalledTimes(1);
  });

  it("still empties it only once under React StrictMode, which runs effects twice in development", () => {
    search = `session_id=${SESSION_ID}`;

    render(
      <StrictMode>
        <ClearCartOnSuccess />
      </StrictMode>,
    );

    expect(clearMock).toHaveBeenCalledTimes(1);
  });

  it("does not empty it again on a re-render", () => {
    search = `session_id=${SESSION_ID}`;

    const view = render(<ClearCartOnSuccess />);
    view.rerender(<ClearCartOnSuccess />);

    expect(clearMock).toHaveBeenCalledTimes(1);
  });

  it("renders nothing", () => {
    search = `session_id=${SESSION_ID}`;

    const { container } = render(<ClearCartOnSuccess />);

    expect(container).toBeEmptyDOMElement();
  });

  it("leaves the cart alone when the page is opened without a session id", () => {
    render(<ClearCartOnSuccess />);

    expect(clearMock).not.toHaveBeenCalled();
  });

  it.each([
    ["an empty value", "session_id="],
    ["a value that is not a Checkout Session", "session_id=pi_3Abc123"],
    ["only the prefix", "session_id=cs_"],
    ["another parameter", `other=${SESSION_ID}`],
    ["markup", "session_id=cs_test_%3Cscript%3Ealert(1)%3C%2Fscript%3E"],
    ["a path trick", "session_id=cs_test_..%2F..%2Fx"],
    ["a value that is far too long", `session_id=cs_test_${"a".repeat(300)}`],
    ["the literal placeholder, as if Stripe never substituted it", "session_id={CHECKOUT_SESSION_ID}"],
  ])("leaves the cart alone for %s", (_label, query) => {
    search = query;

    render(<ClearCartOnSuccess />);

    expect(clearMock).not.toHaveBeenCalled();
  });
});

describe("isCheckoutSessionId", () => {
  it.each([
    SESSION_ID,
    "cs_live_a1B2c3D4",
    `cs_test_${"a".repeat(100)}`,
  ])("accepts %s", (value) => {
    expect(isCheckoutSessionId(value)).toBe(true);
  });

  it.each([
    "",
    "cs_",
    "CS_test_abc",
    "pi_123",
    "cs_test_a b",
    "cs_test_a-b",
    `cs_${"a".repeat(201)}`,
    null,
    undefined,
    42,
    ["cs_test_abc"],
  ])("rejects %j", (value) => {
    expect(isCheckoutSessionId(value)).toBe(false);
  });
});

describe("withSessionIdPlaceholder", () => {
  it("appends Stripe's template variable as a literal, never percent-encoded", () => {
    const url = withSessionIdPlaceholder("https://nerea.example/es/checkout/success");

    expect(url).toBe(
      "https://nerea.example/es/checkout/success?session_id={CHECKOUT_SESSION_ID}",
    );
    expect(url).not.toContain("%7B");
  });

  it("joins with & when the URL already has a query", () => {
    expect(withSessionIdPlaceholder("https://nerea.example/ok?x=1")).toBe(
      "https://nerea.example/ok?x=1&session_id={CHECKOUT_SESSION_ID}",
    );
  });
});
