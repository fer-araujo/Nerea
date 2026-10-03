import type { SanityClient } from "@sanity/client";
import { getSanityWriteClient } from "@/lib/sanity/write-client";

interface ProductIdResult {
  _id: string;
}

/**
 * What happened to each requested handle. Every handle lands in exactly one
 * list, in the order it was asked for.
 */
export interface MarkSoldResult {
  /** Now `sold` in Sanity (an already-sold piece is re-patched: harmless). */
  marked: string[];
  /**
   * No product has this handle (deleted in Studio after the sale, say): there
   * is nothing to mark, and nothing a retry could change. NOT an error.
   */
  missing: string[];
  /**
   * The write could not be done: no write token, the query or the patch
   * failed. A piece in here is still buyable by someone else, so the caller
   * must not let it pass silently (the webhook answers 500 so Stripe retries;
   * the manual sale warns the admin by piece name).
   */
  failed: string[];
}

// Parameterized by $handle — never string-concatenated — so a handle value
// can never alter query structure (GROQ injection).
const PRODUCT_ID_BY_HANDLE_QUERY = `*[_type == "product" && slug.current == $handle][0]{ _id }`;

// Marks each handle's product document `status: "sold"` in Sanity. Called by
// the verified Stripe webhook (app/api/stripe/webhook/route.ts, once a payment
// is confirmed) and by the manual sale ("Marcar como vendida en la tienda").
//
// Idempotent: setting status to "sold" on an already-sold document is a normal
// no-op patch, not an error — Stripe may redeliver the same webhook event (and
// the webhook deliberately asks for redelivery when a piece failed), so this
// must be safe to run twice on the same handle.
//
// Reports instead of hiding: a failure used to be swallowed, which left a PAID
// one-of-one piece buyable with nobody the wiser. Now every handle is
// accounted for in the result, and an unusable write client (no
// SANITY_WRITE_TOKEN, or a client that cannot be built) fails EVERY handle
// rather than quietly doing nothing.
//
// Fails per HANDLE, not per batch: one bad handle in a multi-item cart never
// blocks the rest from being marked sold. This function never throws and never
// logs, so callers need no safety net around it.
export async function markProductsSold(
  handles: string[],
): Promise<MarkSoldResult> {
  const result: MarkSoldResult = { marked: [], missing: [], failed: [] };
  if (handles.length === 0) return result;

  let client: SanityClient | undefined;
  try {
    client = getSanityWriteClient();
  } catch {
    // A write client that cannot even be constructed (an unusable project id,
    // say) is the same outcome as having no token.
    client = undefined;
  }
  if (!client) {
    result.failed.push(...handles);
    return result;
  }

  for (const handle of handles) {
    try {
      const found = await client.fetch<ProductIdResult | null>(
        PRODUCT_ID_BY_HANDLE_QUERY,
        { handle },
      );
      if (!found?._id) {
        result.missing.push(handle);
        continue;
      }

      await client.patch(found._id).set({ status: "sold" }).commit();
      result.marked.push(handle);
    } catch {
      // Network blip, malformed doc, or a race against a manual Studio edit:
      // this handle failed, the rest of the batch still gets its turn.
      result.failed.push(handle);
    }
  }

  return result;
}
