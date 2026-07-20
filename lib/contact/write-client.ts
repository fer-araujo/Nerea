import { createClient, type SanityClient } from "@sanity/client";
import { apiVersion, dataset, projectId } from "@/sanity/env";

// Server-only, write-capable Sanity client for the contact form
// (lib/contact/submit.ts). Mirrors lib/commerce/stripe/client.ts's
// getStripeClient(): constructed LAZILY, only on first use, never at module
// import time — a missing SANITY_WRITE_TOKEN (e.g. `next build` with no real
// token, or local dev before the artisan's Studio token exists) must never
// throw at import time and must never log the token. Read-only catalog
// access uses the separate, token-less `sanityClient` in
// lib/commerce/sanity/client.ts, which cannot write; this client is ONLY
// ever imported by lib/contact/submit.ts.
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
