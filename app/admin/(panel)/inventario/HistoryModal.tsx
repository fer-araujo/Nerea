"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { ModalDialog } from "@/components/admin/Modal";

// A material's history as a modal. The movements are read and paginated on the
// server (`?material=` and `?page=`), so the modal is URL-driven: it is open
// whenever the page renders it, paging inside it just re-renders the page, and
// closing it (Esc or the button) replaces the URL with the one without the
// material. The server-rendered list arrives as `children`.
export function HistoryModal({
  title,
  description,
  closeHref,
  returnFocusId,
  children,
}: {
  title: string;
  description: string;
  /** Where to go when the modal closes: the same view, no material selected. */
  closeHref: string;
  /** The id of the "Historial" link that opened it, to give the focus back. */
  returnFocusId: string;
  children: ReactNode;
}) {
  const router = useRouter();

  return (
    <ModalDialog
      title={title}
      description={description}
      open
      onClose={() => router.replace(closeHref, { scroll: false })}
      returnFocusId={returnFocusId}
      size="lg"
    >
      {children}
    </ModalDialog>
  );
}
