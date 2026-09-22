"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { commerce } from "@/lib/commerce";
import {
  createCheckoutSession,
  type CheckoutLineInput,
} from "@/lib/commerce/stripe/checkout";
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

// Prefers the configured public origin — same env var + trim/strip-trailing-
// slash convention as lib/seo.ts's getSiteUrl() — so the Stripe success/
// cancel redirect is built from a value the artisan controls, never from the
// request's own `Host`/`X-Forwarded-Proto` headers, which a client can send
// arbitrary values for (header spoofing / host-header injection). Header-
// based resolution below only runs when NEXT_PUBLIC_SITE_URL is unset, which
// today is exactly the local-dev case (see env.example).
async function resolveOrigin(): Promise<string> {
  const configuredOrigin = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configuredOrigin) {
    return configuredOrigin.replace(/\/+$/, "");
  }

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
// availability re-check, the re-pricing fetch, building the Stripe session)
// lives inside the try/catch and collapses to one retryable result instead
// of an uncaught exception, satisfying "never redirect to a broken URL,
// never throw uncaught" (spec: cart-checkout-handoff — Checkout Session
// Creation Failure, Unavailable Item at Checkout Time).
//
// SECURITY: `lines` is client-supplied (a Server Action argument, or a
// hand-edited localStorage cart — see cart-context.tsx) and is trusted for
// EXACTLY ONE thing below: which handles were requested. `line.price`,
// `line.title`, and `line.quantity` are read only for the cart UI
// (CartDrawer.tsx) and are NEVER read here — every Stripe line item is
// rebuilt from `commerce.getProductByHandle`, the authoritative Sanity
// catalog, so a tampered client price/quantity can never reach Stripe (and,
// downstream, can never make the webhook in app/api/stripe/webhook/route.ts
// mark a real one-of-one piece sold for an attacker-chosen price).
export async function checkoutAction(
  lines: CartLineItem[],
  locale: Locale,
): Promise<CheckoutActionResult> {
  let redirectUrl: string;

  try {
    // Deduplicated: a doctored cart (or a direct Server Action call) could
    // repeat the same handle more than once — a one-of-one piece must only
    // ever become a single Stripe line item.
    const handles = [...new Set(lines.map((line) => line.handle))];
    const availability = await commerce.getAvailability(handles);
    const soldHandles = handles.filter(
      (handle) => availability[handle] !== "available",
    );

    if (soldHandles.length > 0) {
      return { ok: false, reason: "sold", soldHandles };
    }

    // Re-fetch and re-price from the authoritative catalog, one handle at a
    // time — sequential, not Promise.all, matching mark-sold.ts's own
    // rationale: a one-of-one cart is tiny, so there's no real latency cost,
    // and it keeps this loop simple to reason about. Re-checks availability
    // per product too (not just trusting the batch check above) to close
    // the race window between that check and the Stripe session this fetch
    // feeds — an unknown handle is treated exactly like a sold one.
    const unavailableHandles: string[] = [];
    const checkoutLines: CheckoutLineInput[] = [];

    for (const handle of handles) {
      const product = await commerce.getProductByHandle(handle, locale);
      if (
        product === null ||
        product.availability !== "available" ||
        // A piece with no price (Sanity coalesces a missing one to 0) must
        // never reach Stripe: billing it would mean a free order. Treat it
        // as unavailable, exactly like a sold piece.
        !Number.isInteger(product.price.amount) ||
        product.price.amount <= 0
      ) {
        unavailableHandles.push(handle);
        continue;
      }
      checkoutLines.push({
        name: product.title,
        amount: product.price.amount,
        // One-of-one pieces: always exactly 1, regardless of what the
        // client's `line.quantity` says — see the SECURITY note above.
        quantity: 1,
      });
    }

    if (unavailableHandles.length > 0) {
      return { ok: false, reason: "sold", soldHandles: unavailableHandles };
    }

    const origin = await resolveOrigin();
    redirectUrl = await createCheckoutSession(checkoutLines, {
      successUrl: `${origin}${getPathname({ href: "/checkout/success", locale })}`,
      cancelUrl: `${origin}${getPathname({ href: "/shop", locale })}`,
      // Server-validated handles only — lets the Stripe webhook
      // (app/api/stripe/webhook/route.ts) map the completed payment back to
      // these Sanity product documents.
      handles,
    });
  } catch {
    // Never leak the raw error (could echo request/config details); never
    // redirect to a broken URL. The client keeps the cart and can retry.
    return { ok: false, reason: "checkout-failed" };
  }

  redirect(redirectUrl);
}
