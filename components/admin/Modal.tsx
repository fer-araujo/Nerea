"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { cn } from "@/lib/cn";
import { PRIMARY_BUTTON_CLASS, QUIET_BUTTON_CLASS } from "./styles";

// An accessible modal on the native <dialog>: `showModal()` gives the focus
// trap, the inert background, the top layer and Esc-to-close for free, so there
// is no hand-rolled focus management to get wrong. What is added here is the
// small part the platform leaves out:
//   - the title labels the dialog (`aria-labelledby`);
//   - focus goes to the first field on open (or the close button when there is
//     none) and comes back to what opened it on close;
//   - the page behind does not scroll, and a long form scrolls INSIDE the
//     dialog (header and close button stay put);
//   - the content is mounted only while the dialog is open, so every opening
//     starts from fresh state (a form prefilled from the latest data, never from
//     a stale render) and a page with many modals stays light.
//
// Forms inside call `useModalClose()` when they succeed.

const CloseContext = createContext<() => void>(() => {});

/** The function that closes the modal around the caller; a no-op outside one. */
export function useModalClose(): () => void {
  return useContext(CloseContext);
}

const SIZE_CLASS = {
  md: "w-[min(36rem,calc(100vw-2rem))]",
  lg: "w-[min(46rem,calc(100vw-2rem))]",
} as const;

const FIRST_FIELD = "input:not([type=hidden]), select, textarea";

interface ModalDialogProps {
  title: string;
  /** One short sentence under the title, wired as the dialog's description. */
  description?: string;
  open: boolean;
  /** Called after the dialog has closed (button, Esc, or a form's success). */
  onClose: () => void;
  /** The element to give focus back to; defaults to the one focused on open. */
  returnFocusRef?: RefObject<HTMLElement | null>;
  /** Same, by id, for an opener that can be re-rendered while the dialog is up. */
  returnFocusId?: string;
  size?: keyof typeof SIZE_CLASS;
  children: ReactNode;
}

/** The dialog itself, controlled by its parent. */
export function ModalDialog({
  title,
  description,
  open,
  onClose,
  returnFocusRef,
  returnFocusId,
  size = "md",
  children,
}: ModalDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    const isShown = dialog.hasAttribute("open");

    if (open && !isShown) {
      openerRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      if (typeof dialog.showModal === "function") {
        dialog.showModal();
      } else {
        dialog.setAttribute("open", "");
      }
      const field = dialog.querySelector<HTMLElement>(FIRST_FIELD);
      field?.focus();
    } else if (!open && isShown && typeof dialog.close === "function") {
      dialog.close();
    }
  }, [open]);

  // The page behind must not scroll while the dialog is up.
  useEffect(() => {
    if (!open) {
      return;
    }
    const { body } = document;
    const previous = body.style.overflow;
    body.style.overflow = "hidden";
    return () => {
      body.style.overflow = previous;
    };
  }, [open]);

  function restoreFocus() {
    const target =
      returnFocusRef?.current ??
      (returnFocusId ? document.getElementById(returnFocusId) : null) ??
      openerRef.current;
    if (target?.isConnected) {
      target.focus();
    }
  }

  // Fires for every way out: Esc, the close button, a form's success, or the
  // parent closing it. The platform already restores focus in most browsers;
  // doing it here as well covers the ones that don't focus a clicked button.
  function handleClose() {
    restoreFocus();
    onClose();
  }

  const requestClose = useCallback(() => {
    const dialog = dialogRef.current;
    if (dialog && dialog.hasAttribute("open") && typeof dialog.close === "function") {
      dialog.close();
    } else {
      onClose();
    }
  }, [onClose]);

  return (
    <dialog
      ref={dialogRef}
      onClose={handleClose}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      className={cn(
        // `m-auto` because Tailwind's preflight zeroes the margin that centres
        // a dialog; `open:flex` because a plain `flex` would show it closed.
        "m-auto max-h-[calc(100dvh-2rem)] flex-col border border-line bg-bone p-0 text-ink backdrop:bg-ink/50 open:flex",
        SIZE_CLASS[size],
      )}
    >
      <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4 sm:px-6">
        <div className="min-w-0">
          <h2
            id={titleId}
            className="font-display text-xl leading-snug text-ink [overflow-wrap:anywhere] sm:text-2xl"
          >
            {title}
          </h2>
          {description ? (
            <p
              id={descriptionId}
              className="mt-1 max-w-prose text-sm leading-relaxed text-graphite"
            >
              {description}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={requestClose}
          className={cn(QUIET_BUTTON_CLASS, "shrink-0")}
        >
          Cerrar
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-6">
        {open ? (
          <CloseContext.Provider value={requestClose}>
            {children}
          </CloseContext.Provider>
        ) : null}
      </div>
    </dialog>
  );
}

interface ModalProps
  extends Pick<ModalDialogProps, "title" | "description" | "size" | "children"> {
  triggerLabel: string;
  /** For a trigger that repeats on a page ("Ajustar" of which material). */
  triggerAriaLabel?: string;
  triggerVariant?: "primary" | "quiet";
}

/** A button that opens a modal. Owns the open state; a client island. */
export function Modal({
  triggerLabel,
  triggerAriaLabel,
  triggerVariant = "quiet",
  ...dialog
}: ModalProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-label={triggerAriaLabel}
        onClick={() => setOpen(true)}
        className={
          triggerVariant === "primary" ? PRIMARY_BUTTON_CLASS : QUIET_BUTTON_CLASS
        }
      >
        {triggerLabel}
      </button>
      <ModalDialog
        {...dialog}
        open={open}
        onClose={close}
        returnFocusRef={triggerRef}
      />
    </>
  );
}
