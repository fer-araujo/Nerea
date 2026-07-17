"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { commerce } from "@/lib/commerce";
import { createCheckoutSession } from "@/lib/commerce/stripe/checkout";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/lib/commerce/types";
import type { CartLineItem } from "./cart-context";

export interface CheckoutSoldResult {
  ok: false;
  reason: "sold";
  /** Handles that must be dropped from the client cart. */
  soldHandles: string[];
}

export interface CheckoutFailedResult {
  ok: false;
  /**
   * Covers both a failed availability re-check and a failed Stripe session
   * creation — from the client's perspective both are the same "something
   * went wrong, the cart is intact, try again" outcome.
   */
  reason: "checkout-failed";
}

export type CheckoutActionResult = CheckoutSoldResult | CheckoutFailedResult;

async function resolveOrigin(): Promise<string> {
  const headerList = await headers();
  const host = headerList.get("host") ?? "localhost:3000";
  const forwardedProto = headerList.get("x-forwarded-proto");
  const isLocalHost = host.startsWith("localhost") || host.startsWith("127.0.0.1");
  const protocol = forwardedProto ?? (isLocalHost ? "http" : "https");
  return `${protocol}://${host}`;
}

// Server Action: the sole seam between the client cart and Stripe. Per
// ADR-5 (design.md), availability is re-validated against lib/commerce
// FIRST — a piece that sold after being added to the cart must never reach
// Stripe. `redirect()` is deliberately called OUTSIDE the try/catch below,
// so its internal Next.js control-flow throw is never swallowed by this
// action's own error handling; everything that can legitimately fail (the
// availability re-check, building the Stripe session) lives inside the
// try/catch and collapses to one retryable result instead of an uncaught
// exception, satisfying "never redirect to a broken URL, never throw
// uncaught" (spec: cart-checkout-handoff — Checkout Session Creation
// Failure, Unavailable Item at Checkout Time).
export async function checkoutAction(
  lines: CartLineItem[],
  locale: Locale,
): Promise<CheckoutActionResult> {
  let redirectUrl: string;

  try {
    const handles = lines.map((line) => line.handle);
    const availability = await commerce.getAvailability(handles);
    const soldHandles = handles.filter(
      (handle) => availability[handle] !== "available",
    );

    if (soldHandles.length > 0) {
      return { ok: false, reason: "sold", soldHandles };
    }

    const origin = await resolveOrigin();
    redirectUrl = await createCheckoutSession(
      lines.map((line) => ({
        name: line.title,
        amount: line.price.amount,
        quantity: line.quantity,
      })),
      {
        successUrl: `${origin}${getPathname({ href: "/checkout/success", locale })}`,
        cancelUrl: `${origin}${getPathname({ href: "/shop", locale })}`,
      },
    );
  } catch {
    // Never leak the raw error (could echo request/config details); never
    // redirect to a broken URL. The client keeps the cart and can retry.
    return { ok: false, reason: "checkout-failed" };
  }

  redirect(redirectUrl);
}
