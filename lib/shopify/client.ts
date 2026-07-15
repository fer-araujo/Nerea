import type { ShopifyFetchResult, StorefrontResponse } from "./types";

const API_VERSION = "2025-01";
const DEFAULT_REVALIDATE_SECONDS = 60;
// Bounds how long a single Storefront API call may hang before we give up
// and return a normal { ok: false } result instead of leaving the caller
// waiting indefinitely on a stalled connection.
export const REQUEST_TIMEOUT_MS = 10_000;

interface ShopifyFetchOptions<Variables> {
  query: string;
  variables?: Variables;
  revalidate?: number;
  tags?: string[];
}

// Domain/token are read lazily (not at module load) so importing this module
// never throws in environments where the store isn't provisioned yet.
function getStorefrontConfig():
  | { domain: string; token: string }
  | undefined {
  const domain = process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN;
  const token = process.env.SHOPIFY_STOREFRONT_API_TOKEN;

  if (!domain || !token) {
    return undefined;
  }

  return { domain, token };
}

export async function shopifyFetch<Data, Variables = Record<string, unknown>>({
  query,
  variables,
  revalidate = DEFAULT_REVALIDATE_SECONDS,
  tags,
}: ShopifyFetchOptions<Variables>): Promise<ShopifyFetchResult<Data>> {
  const config = getStorefrontConfig();

  if (!config) {
    return {
      ok: false,
      error: "Shopify Storefront API is not configured.",
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(
      `https://${config.domain}/api/${API_VERSION}/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Storefront-Access-Token": config.token,
        },
        body: JSON.stringify({ query, variables }),
        next: { revalidate, tags },
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      return {
        ok: false,
        error: `Shopify Storefront API request failed with status ${response.status}.`,
      };
    }

    const body = (await response.json()) as StorefrontResponse<Data>;

    if (body.errors?.length) {
      return {
        ok: false,
        error: body.errors.map((e) => e.message).join("; "),
      };
    }

    if (!body.data) {
      return { ok: false, error: "Shopify Storefront API returned no data." };
    }

    return { ok: true, data: body.data };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return {
        ok: false,
        error: "Shopify Storefront API request timed out.",
      };
    }
    // Never surface the raw error — it could echo request headers/token.
    return { ok: false, error: "Shopify Storefront API request failed." };
  } finally {
    clearTimeout(timeoutId);
  }
}
