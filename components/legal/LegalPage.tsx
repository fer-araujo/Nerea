import { getMessages, getTranslations } from "next-intl/server";
import {
  LEGAL_NAMESPACE,
  readLegalDocument,
  type LegalDocumentKey,
} from "@/lib/legal/content";
import type { Locale } from "@/lib/commerce/types";

// Shared body of the three legal routes (privacidad, terminos, envios). The
// copy comes from the `Legal` messages and is rendered strictly as text nodes
// — headings, paragraphs and list items — so nothing in it can ever be
// interpreted as markup. Fully static: no commerce data, no client JS.
export async function LegalPage({
  locale,
  docKey,
}: {
  locale: Locale;
  docKey: LegalDocumentKey;
}) {
  const [messages, t] = await Promise.all([
    getMessages({ locale }),
    getTranslations({ locale, namespace: LEGAL_NAMESPACE }),
  ]);
  const doc = readLegalDocument(messages[LEGAL_NAMESPACE], docKey);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16 sm:px-10 sm:py-24">
      {doc.isDraft ? (
        <div
          role="note"
          className="mb-10 border border-ink/25 bg-bone-sunk px-4 py-3 font-mono text-xs leading-relaxed text-ink"
        >
          <p className="uppercase tracking-[0.14em]">{t("draftTitle")}</p>
          <p className="mt-2 text-graphite">{t("draftBody")}</p>
        </div>
      ) : null}

      <p className="font-mono text-xs uppercase tracking-[0.14em] text-graphite">
        {doc.kicker}
      </p>
      <h1 className="mt-4 font-display text-3xl leading-tight text-ink sm:text-4xl">
        {doc.title}
      </h1>
      <p className="mt-3 font-mono text-xs text-graphite">{doc.updated}</p>
      <p className="mt-6 max-w-prose text-base leading-relaxed text-graphite sm:text-lg">
        {doc.intro}
      </p>

      <div className="mt-12 space-y-10">
        {doc.sections.map((section) => (
          <section key={section.title}>
            <h2 className="font-display text-xl leading-snug text-ink sm:text-2xl">
              {section.title}
            </h2>
            {section.paragraphs.map((paragraph, index) => (
              <p
                key={index}
                className="mt-4 max-w-prose text-base leading-relaxed text-graphite"
              >
                {paragraph}
              </p>
            ))}
            {section.items.length > 0 ? (
              <ul className="mt-4 max-w-prose list-disc space-y-2 pl-5 text-base leading-relaxed text-graphite marker:text-brass-deep">
                {section.items.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            ) : null}
          </section>
        ))}
      </div>
    </main>
  );
}
