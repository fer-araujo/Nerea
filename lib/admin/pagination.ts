// Offset pagination shared by the admin lists. Offset reads (and bills) every
// skipped document, so the page number is bounded; the lists here are small
// (a jeweler's ledger, not a feed), which keeps offsets honest and avoids
// storing cursors.
export const MAX_PAGE = 200;

/** Clamps an untrusted page number: anything else is the first page. */
export function safePage(page: number): number {
  return Number.isInteger(page) && page >= 1 && page <= MAX_PAGE ? page : 1;
}

export function pageOffset(page: number, pageSize: number): number {
  return (safePage(page) - 1) * pageSize;
}

/** `?page=` is user-controlled: anything that isn't a positive integer is 1. */
export function parsePageParam(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const page = Number(value);
  return Number.isInteger(page) && page >= 1 ? page : 1;
}
