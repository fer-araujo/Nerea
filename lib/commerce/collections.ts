// Visibility rule for a collection, in TypeScript. The Sanity adapter never
// runs this: GROQ applies the very same rule server-side
// (COLLECTION_VISIBLE in sanity/queries.ts). It exists for the adapters that do
// not go through GROQ (fixtures), and to pin the rule in one readable place.
//
// A collection is visible when it is switched on AND it has no closing date or
// the closing date is still in the future. Mirrors the GROQ edge cases on
// purpose: only a missing `endsAt` means "no closing date" — a value that does
// not parse as a date is treated as already closed (GROQ's `dateTime()` yields
// null for it, and `null > now` is false), so a typo can only hide a
// collection, never leave a stale one up.
export interface CollectionVisibilityFields {
  active?: boolean | null;
  endsAt?: string | null;
}

export function isCollectionVisible(
  collection: CollectionVisibilityFields,
  now: Date = new Date(),
): boolean {
  if (collection.active !== true) return false;
  if (collection.endsAt === undefined || collection.endsAt === null) return true;

  const endsAt = Date.parse(collection.endsAt);
  return Number.isFinite(endsAt) && endsAt > now.getTime();
}
