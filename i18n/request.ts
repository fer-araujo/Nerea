import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing";
import esMessages from "../messages/es.json";

type MessageTree = Record<string, unknown>;

function isMessageTree(value: unknown): value is MessageTree {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Deep-merges a locale's own messages OVER the default locale's (`es`), key
// by key and namespace by namespace, so any string not yet translated for
// that locale falls back to the ES draft content instead of a missing-
// message error or a blank string (spec: brand-pages — Content Locale
// Fallback). Exported standalone so the fallback behavior is unit-testable
// without mocking next-intl's request lifecycle — see
// tests/locale-fallback.test.ts.
export function deepMergeMessages<T extends MessageTree>(
  base: T,
  override: MessageTree,
): T {
  const result: MessageTree = { ...base };

  for (const key of Object.keys(override)) {
    const baseValue = base[key];
    const overrideValue = override[key];

    result[key] =
      isMessageTree(baseValue) && isMessageTree(overrideValue)
        ? deepMergeMessages(baseValue, overrideValue)
        : overrideValue;
  }

  return result as T;
}

// Messages are static build-time JSON, not per-request data, so the merge
// only needs to run once per non-default locale — cached at module scope
// instead of recomputed on every request.
const mergedMessagesCache = new Map<string, MessageTree>();

async function loadMessages(locale: string): Promise<MessageTree> {
  if (locale === routing.defaultLocale) {
    return esMessages;
  }

  const cached = mergedMessagesCache.get(locale);
  if (cached) return cached;

  const localeMessages = (await import(`../messages/${locale}.json`))
    .default as MessageTree;
  const merged = deepMergeMessages(esMessages, localeMessages);
  mergedMessagesCache.set(locale, merged);
  return merged;
}

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale;

  return {
    locale,
    messages: await loadMessages(locale),
  };
});
