import Link from "next/link";
import { LABEL_CLASS, LINK_CLASS } from "./styles";

// Previous / next links for an offset-paginated admin list (same look and
// wording as the Mensajes pager). A Server Component: `hrefFor` is called
// while the page renders on the server, so a function prop is fine here.
export function Pager({
  page,
  hasNextPage,
  hrefFor,
  label,
}: {
  page: number;
  hasNextPage: boolean;
  hrefFor: (page: number) => string;
  label: string;
}) {
  if (page <= 1 && !hasNextPage) {
    return null;
  }

  return (
    <nav
      aria-label={label}
      className="mt-6 flex items-center justify-between gap-4 border-t border-line pt-4"
    >
      {page > 1 ? (
        <Link href={hrefFor(page - 1)} className={LINK_CLASS}>
          <span aria-hidden="true">←</span>
          Más recientes
        </Link>
      ) : (
        <span />
      )}
      <span className={LABEL_CLASS}>Página {page}</span>
      {hasNextPage ? (
        <Link href={hrefFor(page + 1)} className={LINK_CLASS}>
          Más antiguos
          <span aria-hidden="true">→</span>
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
