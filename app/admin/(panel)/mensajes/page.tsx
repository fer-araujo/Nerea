import type { Metadata } from "next";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { requireAdmin } from "@/lib/admin/auth/session";
import {
  listContactMessages,
  type ContactMessage,
  type ContactMessagePage,
} from "@/lib/admin/data/contact-messages";
import { MarkReadForm } from "./MarkReadForm";

export const metadata: Metadata = {
  title: "Mensajes",
};

const MESSAGES_PATH = "/admin/mensajes";

// Shown in the atelier's own time no matter where the server runs (Netlify
// functions run in UTC).
const DATE_FORMATTER = new Intl.DateTimeFormat("es-MX", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/Mexico_City",
});

const LABEL_CLASS =
  "font-mono text-[11px] uppercase tracking-[0.14em] text-graphite";
const PAGER_LINK_CLASS =
  "inline-flex min-h-11 items-center gap-2 font-sans text-sm text-ink underline decoration-brass underline-offset-4 transition-colors hover:text-brass-deep";

// `?page=` is user-controlled: anything that isn't a positive integer is the
// first page. (listContactMessages() bounds the upper end.)
function parsePage(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const page = Number(value);
  return Number.isInteger(page) && page >= 1 ? page : 1;
}

function pageHref(page: number): string {
  return page <= 1 ? MESSAGES_PATH : `${MESSAGES_PATH}?page=${page}`;
}

// The address was validated on the way in, but it is still visitor-supplied
// data. encodeURIComponent keeps "?", "&", "=" and friends from being read as
// mailto header fields (a smuggled "?bcc=..."); "@" is restored because mail
// clients expect it literal in the recipient.
function mailtoHref(email: string): string {
  return `mailto:${encodeURIComponent(email).replace(/%40/g, "@")}`;
}

async function loadMessages(page: number): Promise<ContactMessagePage | null> {
  try {
    // `null` = Firebase not configured; a throw = Firestore failure. Either
    // way the page shows the same notice instead of crashing the panel.
    return await listContactMessages(page);
  } catch {
    return null;
  }
}

// Every field below is visitor-supplied. It is rendered ONLY as React text
// children (auto-escaped) or as a mailto: href built above — never as HTML.
function MessageItem({ message }: { message: ContactMessage }) {
  return (
    <li
      className={cn(
        "border-l-2 py-6 pl-4 sm:pl-6",
        message.read ? "border-transparent" : "border-brass",
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="font-display text-lg leading-snug text-ink [overflow-wrap:anywhere]">
          {message.name || "Sin nombre"}
        </h2>
        {message.createdAt ? (
          <time
            dateTime={message.createdAt.toISOString()}
            className="font-mono text-xs text-graphite"
          >
            {DATE_FORMATTER.format(message.createdAt)}
          </time>
        ) : null}
      </div>

      {message.email ? (
        <a
          href={mailtoHref(message.email)}
          className="mt-1 inline-block break-all font-mono text-xs text-ink underline decoration-brass underline-offset-4 transition-colors hover:text-brass-deep"
        >
          {message.email}
        </a>
      ) : null}

      <p className="mt-4 max-w-prose whitespace-pre-wrap text-base leading-relaxed text-graphite [overflow-wrap:anywhere]">
        {message.message}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1">
        {message.read ? (
          <span className={LABEL_CLASS}>Leído</span>
        ) : (
          <>
            <span className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-ink">
              <span aria-hidden="true" className="size-1.5 bg-brass" />
              Nuevo
            </span>
            <MarkReadForm id={message.id} />
          </>
        )}
      </div>
    </li>
  );
}

function Pagination({
  page,
  hasNextPage,
}: {
  page: number;
  hasNextPage: boolean;
}) {
  if (page <= 1 && !hasNextPage) {
    return null;
  }

  return (
    <nav
      aria-label="Paginación de mensajes"
      className="mt-6 flex items-center justify-between gap-4 border-t border-line pt-4"
    >
      {page > 1 ? (
        <Link href={pageHref(page - 1)} className={PAGER_LINK_CLASS}>
          <span aria-hidden="true">←</span>
          Más recientes
        </Link>
      ) : (
        <span />
      )}
      <span className={LABEL_CLASS}>Página {page}</span>
      {hasNextPage ? (
        <Link href={pageHref(page + 1)} className={PAGER_LINK_CLASS}>
          Más antiguos
          <span aria-hidden="true">→</span>
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}

export default async function AdminMessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  // The (panel) layout guards too, but a page renders in parallel with its
  // layout — so authorize HERE, before Firestore is touched. React cache()
  // inside requireAdmin() makes the second check free within this render.
  // Kept outside the try/catch below: a redirect is thrown and must propagate.
  await requireAdmin();

  const { page: rawPage } = await searchParams;
  const page = parsePage(rawPage);
  const result = await loadMessages(page);

  return (
    <section>
      <p className={LABEL_CLASS}>Panel</p>
      <h1 className="mt-3 font-display text-3xl leading-tight text-ink sm:text-4xl">
        Mensajes
      </h1>
      <p className="mt-4 max-w-prose text-base leading-relaxed text-graphite">
        Consultas recibidas desde el formulario de contacto, de la más reciente
        a la más antigua.
      </p>

      <div className="mt-10">
        {result === null ? (
          <p
            role="alert"
            className="border border-ink/25 bg-bone-sunk px-4 py-3 font-mono text-xs leading-relaxed text-ink"
          >
            No pudimos cargar los mensajes. Recarga la página e inténtalo de
            nuevo.
          </p>
        ) : result.messages.length === 0 ? (
          <div className="border border-line bg-bone-raised px-6 py-10">
            <p className="font-display text-xl text-ink">
              {page > 1 ? "No hay más mensajes" : "Aún no hay mensajes"}
            </p>
            <p className="mt-2 text-graphite">
              {page > 1
                ? "Esta página ya no tiene mensajes."
                : "Cuando alguien escriba desde el formulario de contacto, aparecerá aquí."}
            </p>
            {page > 1 ? (
              <Link href={MESSAGES_PATH} className={cn(PAGER_LINK_CLASS, "mt-4")}>
                Ir a los más recientes
              </Link>
            ) : null}
          </div>
        ) : (
          <>
            <ul className="divide-y divide-line border-y border-line">
              {result.messages.map((message) => (
                <MessageItem key={message.id} message={message} />
              ))}
            </ul>
            <Pagination page={page} hasNextPage={result.hasNextPage} />
          </>
        )}
      </div>
    </section>
  );
}
