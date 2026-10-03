import "server-only";
import type { Query, QueryDocumentSnapshot } from "firebase-admin/firestore";

// Reads a whole query in cursor-paged batches, up to a hard cap. Used where a
// page needs EVERYTHING in a range (the dashboard's twelve months, the backup)
// rather than one page of it.
//
// A cursor (`startAfter(lastDocument)`), never an offset: an offset makes
// Firestore read — and bill — every document it skips, so paging a few
// thousand documents that way is quadratic. The cursor is the previous
// batch's last DOCUMENT, not its sort value, so several documents sharing one
// `date` (most sales of a day do) can neither be skipped nor repeated at a
// batch boundary.

/** How many documents one round trip asks for. */
export const READ_BATCH_SIZE = 500;

export interface BatchedRead<T> {
  rows: T[];
  /**
   * True when the query holds more than `limit` documents: `rows` is then only
   * the first `limit`, and a total built from it is PARTIAL. Never ignore it.
   */
  truncated: boolean;
}

/**
 * Reads `query` in batches of `batchSize`, up to `limit` documents, parsing
 * each with `parse`. One document beyond the cap is fetched to learn whether
 * the query holds more (it is dropped, never returned).
 *
 * The query's own order is kept (and must be deterministic, which an
 * unordered query is: Firestore breaks every tie by document id). When it
 * has a `select()`, the projection has to include every field it orders by,
 * or Firestore cannot build the cursor from the last document.
 */
export async function readInBatches<T>(
  query: Query,
  parse: (doc: QueryDocumentSnapshot) => T,
  { limit, batchSize = READ_BATCH_SIZE }: { limit: number; batchSize?: number },
): Promise<BatchedRead<T>> {
  const rows: T[] = [];
  let cursor: QueryDocumentSnapshot | undefined;

  // `limit + 1` rows are enough to know the cap was crossed.
  while (rows.length <= limit) {
    const size = Math.min(batchSize, limit + 1 - rows.length);
    const snapshot = await (cursor ? query.startAfter(cursor) : query)
      .limit(size)
      .get();

    for (const doc of snapshot.docs) {
      rows.push(parse(doc));
    }
    if (snapshot.docs.length < size) {
      return { rows, truncated: false };
    }
    cursor = snapshot.docs[snapshot.docs.length - 1];
  }

  return { rows: rows.slice(0, limit), truncated: true };
}
