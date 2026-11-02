// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { Modal, ModalDialog, useModalClose } from "@/components/admin/Modal";

// jsdom ships an EMPTY HTMLDialogElement (no showModal, no close). This models
// the parts of the platform the component relies on: showModal() sets `open`;
// close() removes it and fires a non-bubbling `close` event, exactly what Esc
// does in a browser (after `cancel`).
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    if (!this.hasAttribute("open")) return;
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});

beforeEach(() => {
  document.body.style.overflow = "";
});

const trigger = () => screen.getByRole("button", { name: "Nuevo material" });
const dialogElement = () => document.querySelector("dialog") as HTMLDialogElement;
const isOpen = () => dialogElement().hasAttribute("open");

function Example({ description }: { description?: string }) {
  return (
    <Modal title="Nuevo material" triggerLabel="Nuevo material" description={description}>
      <label>
        Nombre
        <input type="text" />
      </label>
    </Modal>
  );
}

describe("Modal", () => {
  it("renders a closed dialog and a trigger that announces it", () => {
    render(<Example />);

    expect(isOpen()).toBe(false);
    expect(trigger()).toHaveAttribute("aria-haspopup", "dialog");
    // Nothing of the form is mounted while it is closed.
    expect(screen.queryByLabelText("Nombre")).not.toBeInTheDocument();
  });

  it("opens as a modal dialog labelled by its title", () => {
    render(<Example />);

    fireEvent.click(trigger());

    expect(isOpen()).toBe(true);
    const dialog = screen.getByRole("dialog", { name: "Nuevo material" });
    expect(dialog).toBe(dialogElement());
    expect(dialog).toHaveAccessibleName("Nuevo material");
    expect(screen.getByRole("heading", { name: "Nuevo material" })).toBeInTheDocument();
  });

  it("wires an optional description for assistive tech", () => {
    render(<Example description="Cada compra suma a las existencias." />);

    fireEvent.click(trigger());

    expect(screen.getByRole("dialog")).toHaveAccessibleDescription(
      "Cada compra suma a las existencias.",
    );
  });

  it("moves the focus to the first field when it opens", () => {
    render(<Example />);

    fireEvent.click(trigger());

    expect(screen.getByLabelText("Nombre")).toHaveFocus();
  });

  it("closes with its button and gives the focus back to the trigger", () => {
    render(<Example />);
    fireEvent.click(trigger());
    expect(isOpen()).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));

    expect(isOpen()).toBe(false);
    expect(screen.queryByLabelText("Nombre")).not.toBeInTheDocument();
    expect(trigger()).toHaveFocus();
  });

  it("closes on Esc (the native close) and gives the focus back to the trigger", () => {
    render(<Example />);
    fireEvent.click(trigger());
    expect(screen.getByLabelText("Nombre")).toHaveFocus();

    // What the browser does on Esc: the dialog closes itself and fires `close`.
    act(() => dialogElement().close());

    expect(isOpen()).toBe(false);
    expect(trigger()).toHaveFocus();
  });

  it("returns the focus to the trigger even when the browser never focused it (Safari does not focus a clicked button)", () => {
    render(<Example />);
    expect(trigger()).not.toHaveFocus();

    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));

    expect(trigger()).toHaveFocus();
  });

  it("opens again from a clean slate: what was typed before is gone", () => {
    render(<Example />);
    fireEvent.click(trigger());
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Plata" } });
    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));

    fireEvent.click(trigger());

    expect(screen.getByLabelText("Nombre")).toHaveValue("");
  });

  it("lets a form inside close it, as a successful submit does", () => {
    function Saves() {
      const close = useModalClose();
      return (
        <button type="button" onClick={close}>
          Guardar
        </button>
      );
    }
    render(
      <Modal title="Nuevo material" triggerLabel="Nuevo material">
        <Saves />
      </Modal>,
    );
    fireEvent.click(trigger());

    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect(isOpen()).toBe(false);
    expect(trigger()).toHaveFocus();
  });

  it("stops the page behind from scrolling while it is open, and restores it", () => {
    document.body.style.overflow = "auto";
    render(<Example />);

    fireEvent.click(trigger());
    expect(document.body.style.overflow).toBe("hidden");

    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(document.body.style.overflow).toBe("auto");
  });

  it("keeps the header, with its close button, apart from a body that scrolls on its own", () => {
    render(<Example />);
    fireEvent.click(trigger());

    const dialog = screen.getByRole("dialog");
    // Bounded by the viewport, centred (preflight zeroes the auto margin), and
    // laid out as a column only while open (a plain `flex` would show it closed).
    expect(dialog).toHaveClass("max-h-[calc(100dvh-2rem)]", "m-auto", "open:flex", "flex-col");
    const body = screen.getByLabelText("Nombre").closest("div") as HTMLElement;
    expect(body.parentElement).toBe(dialog);
    expect(body).toHaveClass("overflow-y-auto", "min-h-0", "flex-1");
    expect(screen.getByRole("button", { name: "Cerrar" }).closest("div")?.parentElement).toBe(dialog);
  });

  it("names each trigger by what it acts on when several repeat on a page", () => {
    render(
      <Modal
        title="Ajustar existencias"
        triggerLabel="Ajustar"
        triggerAriaLabel="Ajustar Plata fina"
      >
        <p>contenido</p>
      </Modal>,
    );

    expect(screen.getByRole("button", { name: "Ajustar Plata fina" })).toHaveTextContent("Ajustar");
  });
});

describe("ModalDialog", () => {
  it("is controlled: opening and closing follow the `open` prop, and onClose reports a native close", () => {
    const onClose = vi.fn();
    function Host() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Abrir
          </button>
          <ModalDialog
            title="Historial"
            open={open}
            onClose={() => {
              onClose();
              setOpen(false);
            }}
          >
            <p>Contenido</p>
          </ModalDialog>
        </>
      );
    }
    render(<Host />);
    expect(isOpen()).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Abrir" }));
    expect(isOpen()).toBe(true);
    expect(screen.getByText("Contenido")).toBeInTheDocument();

    act(() => dialogElement().close());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(isOpen()).toBe(false);
    expect(screen.queryByText("Contenido")).not.toBeInTheDocument();
  });

  it("gives the focus back to a named element, or to the ref it is handed", () => {
    function Host({ by }: { by: "id" | "ref" }) {
      const [open, setOpen] = useState(false);
      const ref = useRef<HTMLButtonElement>(null);
      return (
        <>
          <button ref={ref} id="opener" type="button" onClick={() => setOpen(true)}>
            Abrir
          </button>
          <ModalDialog
            title="Historial"
            open={open}
            onClose={() => setOpen(false)}
            returnFocusId={by === "id" ? "opener" : undefined}
            returnFocusRef={by === "ref" ? ref : undefined}
          >
            <p>Contenido</p>
          </ModalDialog>
        </>
      );
    }

    for (const by of ["id", "ref"] as const) {
      const { unmount } = render(<Host by={by} />);
      fireEvent.click(screen.getByRole("button", { name: "Abrir" }));
      fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
      expect(screen.getByRole("button", { name: "Abrir" })).toHaveFocus();
      unmount();
    }
  });

  it("closes itself when the parent turns `open` off", () => {
    function Host() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setOpen(false)}>
            Apagar
          </button>
          <ModalDialog title="Historial" open={open} onClose={() => setOpen(false)}>
            <p>Contenido</p>
          </ModalDialog>
        </>
      );
    }
    render(<Host />);
    expect(isOpen()).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Apagar", hidden: true }));

    expect(isOpen()).toBe(false);
  });
});
