import type { NextRequest } from "next/server";
import { parseBody, type ParsedBody } from "next-sanity/webhook";
import { expireTag } from "@/lib/commerce/revalidate";
import {
  CATEGORIES_TAG,
  COLLECTIONS_TAG,
  PRODUCTS_TAG,
} from "@/lib/commerce/sanity/client";
import { SITE_SETTINGS_TAG } from "@/lib/site-settings/adapter";

export const runtime = "nodejs";

// What the Sanity webhook is allowed to expire, by the changed document's type.
// Anything unrecognized falls back to the catalog: purging more than needed
// costs one extra fetch, while a missed purge leaves stale pages up.
//
// - category: its title and slug are projected into every product, and the
//   shop's filter chips read the list itself.
// - collection: the list and the page read it directly, and the pieces carry
//   the slugs/titles of the visible collections they belong to (switching one
//   off or editing its closing date changes what every piece reports).
// - siteSettings: the logo, hero, WhatsApp number and shipping fee, but also
//   the default ring sizes / chain lengths that PRODUCT_BY_HANDLE_QUERY
//   projects into each product (`optionDefaults`).
function tagsFor(type: unknown): string[] {
  switch (type) {
    case "product":
      return [PRODUCTS_TAG];
    case "category":
      return [CATEGORIES_TAG, PRODUCTS_TAG];
    case "collection":
      return [COLLECTIONS_TAG, PRODUCTS_TAG];
    case "siteSettings":
      return [SITE_SETTINGS_TAG, PRODUCTS_TAG];
    default:
      return [PRODUCTS_TAG];
  }
}

function unauthorized(): Response {
  return Response.json({ error: "invalid signature" }, { status: 401 });
}

// Sanity webhook endpoint (sanity.io/manage > API > Webhooks, see the README):
// expires the cached catalog the moment a piece, a category, a collection or
// the site settings change in Studio, instead of waiting out the 60s ISR window.
//
// Signature verification is the ONLY thing standing between this route and
// anyone who can POST to it, so it fails closed:
// - no SANITY_REVALIDATE_SECRET: 401 BEFORE parseBody runs. Without a secret
//   parseBody does not verify anything and answers `isValidSignature: null`;
// - `null` (no signature header) and `false` (wrong signature) are both
//   refused: only an explicit `true` passes;
// - parseBody throws on a body that is not JSON even when the signature was
//   wrong, so a throw is just another unverifiable request.
// Nothing is revalidated on any of those, and the body is never logged.
//
// The webhook projection is `{_type}`, and the 3s wait that parseBody does for
// Content Lake to settle is deliberate: expiring first would let the next
// request re-cache the old document.
export async function POST(req: NextRequest): Promise<Response> {
  const secret = process.env.SANITY_REVALIDATE_SECRET;
  if (!secret?.trim()) {
    return unauthorized();
  }

  let parsed: ParsedBody<{ _type?: unknown }>;
  try {
    parsed = await parseBody<{ _type?: unknown }>(req, secret);
  } catch {
    return unauthorized();
  }
  if (parsed.isValidSignature !== true) {
    return unauthorized();
  }

  const tags = tagsFor(parsed.body?._type);
  for (const tag of tags) {
    expireTag(tag);
  }

  return Response.json({ revalidated: tags });
}
