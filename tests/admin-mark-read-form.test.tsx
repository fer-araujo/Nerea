// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// The Server Action is mocked: this file covers only what the form island
// adds on top of it — showing the typed result inline. The action's own
// behavior (authorization first, validation, typed failures) is in
// tests/admin-mark-read-action.test.ts.
const markActionMock = vi.fn();

vi.mock("@/app/admin/(panel)/mensajes/actions", () => ({
  markMessageReadAction: (...args: unknown[]) => markActionMock(...args),
}));

import { MarkReadForm } from "../app/admin/(panel)/mensajes/MarkReadForm";

const BUTTON = "Marcar como leído";
const ERROR_TEXT = "No se pudo actualizar. Intenta de nuevo.";

beforeEach(() => {
  vi.resetAllMocks();
});

describe("MarkReadForm", () => {
  it("submits the message id to the Server Action", async () => {
    markActionMock.mockResolvedValue({ ok: true });
    render(<MarkReadForm id="abc123" />);

    fireEvent.click(screen.getByRole("button", { name: BUTTON }));

    await waitFor(() => expect(markActionMock).toHaveBeenCalledTimes(1));
    const [, formData] = markActionMock.mock.calls[0];
    expect((formData as FormData).get("id")).toBe("abc123");
  });

  it("shows no error before anything is attempted", () => {
    render(<MarkReadForm id="abc123" />);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a small inline Spanish error when the action reports a failure", async () => {
    markActionMock.mockResolvedValue({ ok: false, error: "failed" });
    render(<MarkReadForm id="abc123" />);

    fireEvent.click(screen.getByRole("button", { name: BUTTON }));

    expect(await screen.findByRole("alert")).toHaveTextContent(ERROR_TEXT);
    // The button is back so the admin can simply try again.
    expect(screen.getByRole("button", { name: BUTTON })).toBeEnabled();
  });

  it("shows no error when the action succeeds", async () => {
    markActionMock.mockResolvedValue({ ok: true });
    render(<MarkReadForm id="abc123" />);

    fireEvent.click(screen.getByRole("button", { name: BUTTON }));
    await waitFor(() => expect(markActionMock).toHaveBeenCalledTimes(1));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
