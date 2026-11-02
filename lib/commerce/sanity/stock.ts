import { createHash } from "node:crypto";
import type { SanityClient } from "@sanity/client";
import { getSanityWriteClient } from "@/lib/sanity/write-client";

/** Units of one piece that were just sold. */
export interface StockDecrement {
  handle: string;
  /** A positive whole number. */
  qty: number;
}

/**
 * What happened to each requested handle. Every handle lands in exactly one of
 * `decremented`, `missing` and `failed`, in the order it was first asked for;
 * `oversold` and `alreadyApplied` are subsets of `decremented`.
 */
export interface DecrementStockResult {
  /**
   * Its stock is lowered for this sale (and, at 0, the piece is now "sold"):
   * either by this call or, see `alreadyApplied`, by an earlier one.
   */
  decremented: string[];
  /**
   * No product has this handle (deleted in Studio after the sale, say): there
   * is nothing to lower, and nothing a retry could change. NOT an error.
   */
  missing: string[];
  /**
   * The stock could NOT be lowered: no write token, the lookup or the
   * transaction failed, the source id is unusable, or the quantity was not a
   * positive whole number. The piece may still be buyable, so the caller must
   * not let it pass silently (the webhook answers 500 so Stripe retries; the
   * manual sale warns the admin by piece name). Nothing was written for a
   * handle in here.
   */
  failed: string[];
  /**
   * More units were sold than the shop had (two shoppers paid for the last one
   * at the same time, or the stock was lower than the sale): the stock was
   * clamped back to 0, and the sale needs a human look ("Revisar: sobreventa").
   * Only reported by the call that actually lowered the stock.
   */
  oversold: string[];
  /**
   * The marker of this (sale, handle) already existed: an earlier call, or a
   * concurrent one, lowered the stock, so this call changed NOTHING. A success,
   * never a failure: it is what makes a retry safe.
   */
  alreadyApplied: string[];
}

interface ProductStockDoc {
  _id: string;
  status?: string | null;
  stock?: number | null;
  _rev?: string;
}

// Parameterized by $handle — never string-concatenated — so a handle value
// can never alter query structure (GROQ injection). A DRAFT of a piece shares
// its slug with the published document: decrementing the draft would leave the
// real stock untouched (and publishing it later would restore the old count),
// so drafts are excluded here, whatever the client's perspective is.
export const PRODUCT_STOCK_BY_HANDLE_QUERY = `*[_type == "product" && slug.current == $handle && !(_id in path("drafts.**"))][0]{ _id, status, stock }`;

// What ties a sale to the stock it took. Sanity ids may only hold
// [a-zA-Z0-9._-]; a dot makes a document a non-public "path" document, so the
// markers can never be read without a token. The source id (a Stripe Checkout
// Session id, or the id of a manual sale) must not hold a dot itself, which
// would make the id ambiguous.
const MOVE_SOURCE_PATTERN = /^[A-Za-z0-9_-]{1,120}$/;

/**
 * The id of the marker document for one (sale, handle):
 * `stockmove.<source id>.<first 32 hex of sha256(handle)>`. The handle is
 * hashed because it is free text in Studio and ids are restricted; the hash is
 * deterministic, so the SAME sale always produces the SAME id, which is what
 * lets Sanity refuse a second `create`.
 */
export function stockMoveId(sourceId: string, handle: string): string {
  const hash = createHash("sha256").update(handle).digest("hex").slice(0, 32);
  return `stockmove.${sourceId}.${hash}`;
}

function isQuantity(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

// Several lines of the same handle (two ring sizes of one design) are ONE
// decrement: the stock is per design. An invalid quantity poisons only its own
// handle (it is reported as failed, never silently treated as 1).
function groupByHandle(
  items: readonly StockDecrement[],
): Map<string, number | null> {
  const quantities = new Map<string, number | null>();
  for (const { handle, qty } of items) {
    const current = quantities.get(handle);
    if (current === null || !isQuantity(qty)) {
      quantities.set(handle, null);
    } else {
      quantities.set(handle, (current ?? 0) + qty);
    }
  }
  return quantities;
}

// A document that predates the `stock` field holds the legacy status instead:
// "available" is one piece, anything else none (the fail-safe in
// lib/commerce/transforms.ts `toStock`).
function legacyStock(status: unknown): number {
  return status === "available" ? 1 : 0;
}

// `create` of an id that exists is refused by Sanity with a 409 ("Document by
// ID … already exists"). The status code is the contract; the wording is the
// fallback for an SDK that surfaces it differently.
function isAlreadyExists(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { statusCode, response, message } = error as {
    statusCode?: unknown;
    response?: { statusCode?: unknown };
    message?: unknown;
  };
  return (
    statusCode === 409 ||
    response?.statusCode === 409 ||
    (typeof message === "string" && /already exists/i.test(message))
  );
}

/**
 * Takes `qty` units off each handle's stock in Sanity, ONCE per `sourceId`.
 * Called by the verified Stripe webhook (`sourceId` = the Checkout Session id)
 * and by the manual sale ("Descontar de la tienda", `sourceId` = the sale id).
 *
 * Per handle, ONE Sanity transaction does three things atomically:
 * `create` a marker document (`stockmove.<sourceId>.<hash of the handle>`),
 * `setIfMissing({ stock })` (a document that predates the field starts from
 * its legacy status: 1 if available, else 0) and an atomic `dec({ stock: qty })`.
 * Because the marker is created in the same transaction as the decrement, they
 * land together or not at all, and a second attempt for the same sale (a retry
 * after a failure in between, a redelivery, two deliveries at the same moment,
 * a Dashboard resend) is refused by Sanity itself with "already exists": that
 * handle is reported in `alreadyApplied` and nothing is lowered again. The
 * decrement is also atomic against OTHER sales, so two sales landing at once
 * can never overwrite each other's count: the second just sees the lower number.
 *
 * The transaction answers with the product as it is AFTER the decrement, and
 * that decides the follow-up: at 0 the legacy `status` becomes "sold"; below 0
 * (a concurrent oversell) the stock is clamped back to 0 and the handle is
 * reported in `oversold`; above 0 a stale "sold" status is put right (the
 * artisan raised the stock in Studio, where `status` is read-only). That
 * follow-up is best-effort bookkeeping: `stock` is what the storefront reads,
 * so a failed follow-up never turns an applied decrement into a failure.
 *
 * Reports instead of hiding, and fails per HANDLE, not per batch. An unusable
 * write client (no SANITY_WRITE_TOKEN, or one that cannot be built), or a
 * `sourceId` that cannot make a valid marker id, fails EVERY handle rather than
 * quietly doing nothing (or, worse, doing it without the marker). This function
 * never throws and never logs, so callers need no safety net around it.
 */
export async function decrementStock(
  items: readonly StockDecrement[],
  sourceId: string,
): Promise<DecrementStockResult> {
  const result: DecrementStockResult = {
    decremented: [],
    missing: [],
    failed: [],
    oversold: [],
    alreadyApplied: [],
  };
  const quantities = groupByHandle(items);
  if (quantities.size === 0) return result;

  let client: SanityClient | undefined;
  try {
    client = getSanityWriteClient();
  } catch {
    // A write client that cannot even be constructed (an unusable project id,
    // say) is the same outcome as having no token.
    client = undefined;
  }
  if (!client || !MOVE_SOURCE_PATTERN.test(sourceId)) {
    result.failed.push(...quantities.keys());
    return result;
  }

  for (const [handle, qty] of quantities) {
    if (qty === null) {
      result.failed.push(handle);
      continue;
    }

    let found: ProductStockDoc | null;
    try {
      found = await client.fetch<ProductStockDoc | null>(
        PRODUCT_STOCK_BY_HANDLE_QUERY,
        { handle },
      );
    } catch {
      // Not knowing whether the piece exists is not "missing".
      result.failed.push(handle);
      continue;
    }
    if (!found?._id) {
      result.missing.push(handle);
      continue;
    }

    let after: ProductStockDoc | undefined;
    try {
      const committed = await client
        .transaction()
        .create({
          _id: stockMoveId(sourceId, handle),
          _type: "stockMove",
          sessionId: sourceId,
          handle,
          qty,
          at: new Date().toISOString(),
        })
        .patch(found._id, (patch) =>
          patch.setIfMissing({ stock: legacyStock(found.status) }),
        )
        .patch(found._id, (patch) => patch.dec({ stock: qty }))
        .commit({ returnDocuments: true });
      after = committed[committed.length - 1] as ProductStockDoc | undefined;
    } catch (error) {
      if (isAlreadyExists(error)) {
        // This sale's units are off already (the transaction is atomic, so the
        // refused `create` also rolled back this attempt's decrement).
        result.decremented.push(handle);
        result.alreadyApplied.push(handle);
      } else {
        // Network blip, a document changed under us, or a Studio edit that
        // raced: nothing was written for this handle.
        result.failed.push(handle);
      }
      continue;
    }

    result.decremented.push(handle);
    const remaining = after?.stock;
    if (typeof remaining !== "number" || !Number.isFinite(remaining)) {
      continue;
    }
    const oversold = remaining < 0;
    if (oversold) result.oversold.push(handle);

    const status = remaining > 0 ? "available" : "sold";
    if (oversold || after?.status !== status) {
      try {
        await client
          .patch(found._id)
          .set(oversold ? { stock: 0, status } : { status })
          .commit();
      } catch {
        // Cosmetic: availability follows `stock`, which is already right.
      }
    }
  }

  return result;
}
