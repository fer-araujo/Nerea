import "server-only";
import type Stripe from "stripe";
import { isCentavos } from "@/lib/admin/domain/money";
import { getStripeClient } from "@/lib/commerce/stripe/client";

// What Stripe charged for a paid Checkout Session, read from its balance
// transaction. Used by the webhook when it records a sale
// (stripe-sales.ts) and by the "Actualizar comisión" action for a sale whose
// fee could not be read at the time (sales.ts).
//
// NEVER throws and never logs: a fee that cannot be read is an expected
// outcome ("pending"), not an error. The webhook must not answer 500 for it (a
// retry cannot fix a fee Stripe has not settled yet, and the sale itself is
// already worth recording), and an error here could echo request details.

export interface StripeFees {
  /**
   * What Stripe charged for the payment, integer centavos. Stripe reports its
   * own fee and the IVA on that fee together, and this is the total.
   */
  fee: number;
  /** What Stripe deposits for the payment: the amount charged minus the fee. */
  net: number;
}

// A Checkout Session id, and nothing that could alter the request path.
const SESSION_ID_PATTERN = /^cs_[A-Za-z0-9_]{1,200}$/;

// One call returns the session with its payment, the charge and the balance
// transaction already attached.
const EXPAND = ["payment_intent.latest_charge.balance_transaction"];

// Bounded: the webhook is waiting on this call, and Stripe's own delivery
// timeout (and the host's function limit) is far shorter than the SDK's 80 s
// default, plus a retry. A slow answer just becomes a pending fee.
const REQUEST_OPTIONS = { timeout: 4_000, maxNetworkRetries: 0 };

// Walks the expanded session down to its balance transaction. Anything that is
// still an unexpanded id, or missing, means Stripe has not settled the payment
// yet (a card payment's balance transaction can lag its confirmation).
function readFees(session: Stripe.Checkout.Session): StripeFees | null {
  const paymentIntent = session.payment_intent;
  if (typeof paymentIntent !== "object" || paymentIntent === null) {
    return null;
  }
  const charge = paymentIntent.latest_charge;
  if (typeof charge !== "object" || charge === null) {
    return null;
  }
  const transaction = charge.balance_transaction;
  if (typeof transaction !== "object" || transaction === null) {
    return null;
  }

  const { fee, net, currency } = transaction;
  // The storefront is MXN-only, and so are the books: a fee in another
  // settlement currency would be a number in the wrong unit, so it is not used.
  if (currency !== "mxn" || !isCentavos(fee) || !isCentavos(net)) {
    return null;
  }
  return { fee, net };
}

/**
 * The fee and net of a paid Checkout Session, or `null` when they are not
 * available (Stripe is not configured, the balance transaction is not settled
 * yet, the session is unknown to this account, the call failed or timed out).
 */
export async function fetchStripeFees(
  sessionId: string,
): Promise<StripeFees | null> {
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    return null;
  }

  try {
    const stripe = getStripeClient();
    if (!stripe) {
      return null;
    }
    const session = await stripe.checkout.sessions.retrieve(
      sessionId,
      { expand: EXPAND },
      REQUEST_OPTIONS,
    );
    return readFees(session);
  } catch {
    return null;
  }
}
