import { createClient, type SanityClient } from "@sanity/client";
import { apiVersion, dataset, projectId } from "@/sanity/env";

// Server-only, write-capable Sanity client shared by every write path in
// this app — currently lib/contact/submit.ts (contact messages) and
// lib/commerce/sanity/mark-sold.ts (the Stripe webhook marking a purchased
// piece sold). Originally lived under lib/contact/ before the webhook
// needed the same capability; moved here so a commerce-layer module never
// has to reach into an unrelated feature folder for shared infra.
//
// Constructed LAZILY, only on first use, never at module import time — a
// missing SANITY_WRITE_TOKEN (e.g. `next build` with no real token, or
// local dev before the artisan's Studio token exists) must never throw at
// import time and must never log the token. Read-only catalog access uses
// the separate, token-less `sanityClient` in lib/commerce/sanity/client.ts,
// which cannot write.
let cachedClient: SanityClient | undefined;

export function getSanityWriteClient(): SanityClient | undefined {
  if (cachedClient) {
    return cachedClient;
  }

  const token = process.env.SANITY_WRITE_TOKEN;
  if (!token) {
    return undefined;
  }

  cachedClient = createClient({
    projectId,
    dataset,
    apiVersion,
    token,
    useCdn: false,
  });
  return cachedClient;
}
