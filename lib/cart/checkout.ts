"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { commerce } from "@/lib/commerce";
import {
  formatOptionLabel,
  serializeOption,
  validateOption,
} from "@/lib/commerce/options";
import {
  createCheckoutSession,
  type CheckoutLineInput,
  type CheckoutOptionInput,
} from "@/lib/commerce/stripe/checkout";
import { isStripeConfigured } from "@/lib/commerce/stripe/config";
import type { SessionItem } from "@/lib/commerce/stripe/metadata";
import { getPathname } from "@/i18n/navigation";
import { getShippingFee } from "@/lib/site-settings/adapter";
import type { Locale, SelectedOption } from "@/lib/commerce/types";
import type { CartLineItem } from "./cart-context";
import { withSessionIdPlaceholder } from "./checkout-session";

export interface CheckoutPaymentsDisabledResult {
  ok: false;
  /**
   * Online payments are not switched on yet (no Stripe key). The cart is left
   * untouched and the drawer swaps its checkout button for "reserve by
   * message". Distinct from `checkout-failed`, which invites a retry that
   * could never succeed here.
   */
  reason: "payments-disabled";
}

export interface CheckoutSoldResult {
  ok: false;
  reason: "sold";
  /** Handles that must be dropped from the client cart. */
  soldHandles: string[];
}

export interface CheckoutInvalidOptionResult {
  ok: false;
  reason: "invalid-option";
  /**
   * Handles whose chosen ring size / chain length is missing or no longer
   * valid for the catalog. Like `soldHandles`, the client drops these lines
   * and asks the shopper to choose the option again.
   */
  handles: string[];
}

export interface CheckoutInsufficientStockResult {
  ok: false;
  reason: "insufficient-stock";
  /**
   * Pieces whose requested total (all their lines added up) is above what the
   * shop has right now, with how many ARE available (at least 1: a piece with
   * none is reported as `sold` instead). The client clamps those lines to
   * `available` and asks the shopper to review the cart.
   */
  items: { handle: string; available: number }[];
}

export interface CheckoutCartTooLargeResult {
  ok: false;
  /**
   * The cart has more lines, or more units on one line, than a single checkout
   * takes (see MAX_CART_LINES and MAX_LINE_QUANTITY). Nothing was read: the
   * request is refused before any catalog access, so an absurd payload costs
   * the shop nothing. The cart is left as it is; the shopper pays in parts.
   */
  reason: "cart-too-large";
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

export type CheckoutActionResult =
  | CheckoutPaymentsDisabledResult
  | CheckoutSoldResult
  | CheckoutInsufficientStockResult
  | CheckoutInvalidOptionResult
  | CheckoutCartTooLargeResult
  | CheckoutFailedResult;

// Both catalog reads below skip the storefront's 60s ISR cache. A cached
// "available" can outlive a sale by a while, and a one-of-one piece that just
// sold must never reach Stripe a second time. Not exported: a "use server"
// module may only export async functions.
const FRESH_READ = { fresh: true } as const;

// The most a single checkout takes. A Server Action is a public endpoint, so
// the size of `lines` is the caller's to choose: without a bound, one request
// could make the action read the catalog once per line, and a Stripe session
// has its own limits anyway (the metadata, the line items). Real carts are a
// handful of pieces; these are far above that. Not exported: a "use server"
// module may only export async functions.
const MAX_CART_LINES = 50;
const MAX_LINE_QUANTITY = 99;

// One client-claimed line, reduced to what the action reads from it. The
// option stays `unknown`: it is only ever a claim for `validateOption`.
interface ClaimedLine {
  option: unknown;
  quantity: number;
}

function isQuantity(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

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

// Server Action: the sole seam between the client cart and Stripe. While
// payments are off (no Stripe key) it refuses before anything else: a
// Server Action is a public endpoint, so hiding the checkout button in the
// drawer is not enough — the guard has to live here, ahead of any Sanity read.
// Per ADR-5 (design.md), availability is then re-validated against
// lib/commerce — a piece that sold after being added to the cart must never
// reach Stripe. `redirect()` is deliberately called OUTSIDE the try/catch below,
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
// EXACTLY THREE things below: which handles were requested; each line's
// `option`, as a CLAIM that is validated against the catalog's own resolved
// options (`validateOption`) — only a value that matches is ever used, and
// what reaches Stripe is the catalog's copy of it, not the client's; and each
// line's `quantity`, as a CLAIM too: it must be a positive whole number, and
// the units of one piece (all its lines added up) must fit the piece's FRESH,
// uncached stock — otherwise nothing reaches Stripe. `line.price`,
// `line.title` and `line.stock` are read only for the cart UI
// (CartDrawer.tsx) and are NEVER read here — every Stripe line item is rebuilt
// from `commerce.getProductByHandle`, the authoritative Sanity catalog (base
// price + the catalog's extra for the validated option), so a tampered client
// price can never reach Stripe (and, downstream, can never make the webhook in
// app/api/stripe/webhook/route.ts take stock off a real piece for an
// attacker-chosen price). The shipping fee is read from the site settings here
// too, never from the client.
export async function checkoutAction(
  lines: CartLineItem[],
  locale: Locale,
): Promise<CheckoutActionResult> {
  if (!isStripeConfigured()) {
    return { ok: false, reason: "payments-disabled" };
  }

  let redirectUrl: string;

  try {
    if (!Array.isArray(lines)) {
      return { ok: false, reason: "checkout-failed" };
    }
    // Bounded BEFORE anything is read or looped over per line.
    if (lines.length > MAX_CART_LINES) {
      return { ok: false, reason: "cart-too-large" };
    }

    // The claims per handle, in the order the handles first appear. A repeated
    // handle is normal now (the same piece in two sizes); a doctored cart can
    // also repeat the very same line, which simply adds up.
    const claims = new Map<string, ClaimedLine[]>();
    for (const line of lines) {
      if (typeof line.handle !== "string" || !isQuantity(line.quantity)) {
        // Not something the drawer can produce: refuse the whole request
        // rather than guess what was meant.
        return { ok: false, reason: "checkout-failed" };
      }
      if (line.quantity > MAX_LINE_QUANTITY) {
        return { ok: false, reason: "cart-too-large" };
      }
      const claimed = claims.get(line.handle) ?? [];
      claimed.push({ option: line.option, quantity: line.quantity });
      claims.set(line.handle, claimed);
    }
    const handles = [...claims.keys()];
    const availability = await commerce.getAvailability(handles, FRESH_READ);
    const soldHandles = handles.filter(
      (handle) => availability[handle] !== "available",
    );

    if (soldHandles.length > 0) {
      return { ok: false, reason: "sold", soldHandles };
    }

    // Re-fetch and re-price from the authoritative catalog, one handle at a
    // time — sequential, not Promise.all: a cart is tiny, so there's no real
    // latency cost, and it keeps this loop simple to reason about. Re-checks
    // availability per product too (not just trusting the batch check above)
    // to close the race window between that check and the Stripe session this
    // fetch feeds — an unknown handle is treated exactly like a sold one.
    const unavailableHandles: string[] = [];
    const insufficient: CheckoutInsufficientStockResult["items"] = [];
    const invalidOptionHandles: string[] = [];
    const checkoutLines: CheckoutLineInput[] = [];
    const checkoutOptions: CheckoutOptionInput[] = [];
    const checkoutItems: SessionItem[] = [];

    for (const [handle, claimed] of claims) {
      const product = await commerce.getProductByHandle(
        handle,
        locale,
        FRESH_READ,
      );
      if (
        product === null ||
        product.availability !== "available" ||
        // The piece count must be a usable whole number: anything else (a
        // read that carried none) cannot prove the cart fits, so it is
        // treated like a sold piece instead of waved through.
        !Number.isInteger(product.stock) ||
        product.stock < 1 ||
        // A piece with no price (Sanity coalesces a missing one to 0) must
        // never reach Stripe: billing it would mean a free order. Treat it
        // as unavailable, exactly like a sold piece.
        !Number.isInteger(product.price.amount) ||
        product.price.amount <= 0
      ) {
        unavailableHandles.push(handle);
        continue;
      }

      // The units of one piece are counted across ALL its lines (two sizes of
      // the same ring draw from the same stock).
      const requested = claimed.reduce((sum, line) => sum + line.quantity, 0);
      if (requested > product.stock) {
        insufficient.push({ handle, available: product.stock });
        continue;
      }

      // A required option that is missing, a value the catalog does not
      // offer (tampered, or since removed in Studio) and an option on a piece
      // that takes none are all the same outcome: the shopper must choose
      // again. `check.extra` is the CATALOG's surcharge — already proven to
      // be a non-negative integer — so the unit amount below stays a
      // positive integer.
      const merged = new Map<
        string,
        { option: SelectedOption | null; extra: number; quantity: number }
      >();
      let optionsValid = true;
      for (const line of claimed) {
        const check = validateOption(product.options, line.option);
        if (!check.valid) {
          optionsValid = false;
          break;
        }
        // Keyed by the catalog's validated copy, so two spellings of one
        // option (a forged extra field, say) are the same line.
        const key = check.option
          ? serializeOption(handle, check.option)
          : handle;
        const existing = merged.get(key);
        if (existing) {
          existing.quantity += line.quantity;
        } else {
          merged.set(key, {
            option: check.option,
            extra: check.extra,
            quantity: line.quantity,
          });
        }
      }
      if (!optionsValid) {
        invalidOptionHandles.push(handle);
        continue;
      }

      for (const { option, extra, quantity } of merged.values()) {
        checkoutLines.push({
          name: option
            ? `${product.title} — ${formatOptionLabel(option, locale)}`
            : product.title,
          amount: product.price.amount + extra,
          quantity,
        });
        checkoutItems.push({ handle, quantity, ...(option ? { option } : {}) });
        if (option) {
          checkoutOptions.push({ handle, option });
        }
      }
    }

    // Sold wins over everything: a piece that is gone cannot be fixed by
    // choosing again or by taking fewer. Then too many units, then options:
    // each is reported on the next attempt, once the shopper has dealt with
    // the one before.
    if (unavailableHandles.length > 0) {
      return { ok: false, reason: "sold", soldHandles: unavailableHandles };
    }

    if (insufficient.length > 0) {
      return { ok: false, reason: "insufficient-stock", items: insufficient };
    }

    if (invalidOptionHandles.length > 0) {
      return {
        ok: false,
        reason: "invalid-option",
        handles: invalidOptionHandles,
      };
    }

    // Independent reads, so they run together. A failed fee read throws into
    // the catch below (checkout-failed) instead of defaulting to free shipping.
    const [origin, shippingFee] = await Promise.all([
      resolveOrigin(),
      getShippingFee(),
    ]);
    redirectUrl = await createCheckoutSession(checkoutLines, {
      // Stripe fills the session id in on the way back, and the success page
      // uses it to empty the cart (components/checkout/ClearCartOnSuccess.tsx).
      successUrl: withSessionIdPlaceholder(
        `${origin}${getPathname({ href: "/checkout/success", locale })}`,
      ),
      cancelUrl: `${origin}${getPathname({ href: "/shop", locale })}`,
      shippingFee,
      locale,
      // Server-validated handles and items only — lets the Stripe webhook
      // (app/api/stripe/webhook/route.ts) map the completed payment back to
      // these Sanity product documents and take the right units off each one.
      handles,
      items: checkoutItems,
      // Catalog-validated options only (empty for pieces without one).
      options: checkoutOptions,
    });
  } catch {
    // Never leak the raw error (could echo request/config details); never
    // redirect to a broken URL. The client keeps the cart and can retry.
    return { ok: false, reason: "checkout-failed" };
  }

  redirect(redirectUrl);
}
