"use client";

import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { useCart } from "@/lib/cart/cart-context";
import {
  SESSION_ID_PARAM,
  isCheckoutSessionId,
} from "@/lib/cart/checkout-session";

// Empties the cart once the shopper is back from a PAID Stripe Checkout:
// without this the piece they just bought would still sit in the drawer.
//
// The trigger is the Checkout Session id Stripe puts in the success URL
// (`?session_id=cs_…`, see lib/cart/checkout.ts). A visit without a valid one,
// such as a bookmark or a hand-typed address, leaves the cart alone. The id is
// only a "this came from Stripe" marker, not proof of payment: the worst a
// forged link can do is clear the visitor's own cart, and the sale itself is
// recorded by the verified webhook, never by this page.
//
// A client island reading `useSearchParams` (inside a Suspense boundary on the
// page) rather than the page reading `searchParams`: that keeps the success
// page statically rendered. Renders nothing.
export function ClearCartOnSuccess() {
  const { clear } = useCart();
  const sessionId = useSearchParams().get(SESSION_ID_PARAM);
  const shouldClear = isCheckoutSessionId(sessionId);
  // React StrictMode runs effects twice in development; the ref keeps this to
  // one `clear()` per mount.
  const cleared = useRef(false);

  useEffect(() => {
    if (!shouldClear || cleared.current) {
      return;
    }
    cleared.current = true;
    clear();
  }, [shouldClear, clear]);

  return null;
}
