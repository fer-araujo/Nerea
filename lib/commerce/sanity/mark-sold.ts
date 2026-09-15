import { getSanityWriteClient } from "@/lib/sanity/write-client";

interface ProductIdResult {
  _id: string;
}

// Parameterized by $handle — never string-concatenated — so a handle value
// can never alter query structure (GROQ injection).
const PRODUCT_ID_BY_HANDLE_QUERY = `*[_type == "product" && slug.current == $handle][0]{ _id }`;

// Marks each purchased handle's product document `status: "sold"` in
// Sanity. The only caller is the verified Stripe webhook
// (app/api/stripe/webhook/route.ts, on checkout.session.completed) — every
// handle passed in here has already been paid for.
//
// Idempotent: setting status to "sold" on an already-sold document is a
// normal no-op patch, not an error — Stripe may redeliver the same webhook
// event, and this must be safe to run twice on the same handle.
//
// Fails safe PER HANDLE, not per batch: an unknown/deleted handle (no
// matching document) is skipped instead of throwing, so one bad handle in a
// multi-item cart never blocks the rest of the batch from being marked
// sold. A missing SANITY_WRITE_TOKEN degrades to a silent no-op (nothing to
// patch with), matching lib/contact/submit.ts's fail-safe convention — this
// function never throws.
export async function markProductsSold(handles: string[]): Promise<void> {
  if (handles.length === 0) return;

  const client = getSanityWriteClient();
  if (!client) return;

  for (const handle of handles) {
    try {
      const result = await client.fetch<ProductIdResult | null>(
        PRODUCT_ID_BY_HANDLE_QUERY,
        { handle },
      );
      if (!result?._id) continue;

      await client.patch(result._id).set({ status: "sold" }).commit();
    } catch {
      // Network blip, malformed doc, or a race against a manual Studio
      // edit — never let one handle's failure abort the rest of the batch.
    }
  }
}
