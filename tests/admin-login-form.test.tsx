// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// The Firebase client SDK, the Server Action and the router are all mocked:
// this file pins what the LOGIN FORM itself guarantees — above all that no
// failure mode ever tells the user whether an email has an account.
const signInMock = vi.fn();
const sendVerificationEmailMock = vi.fn();
const sendPasswordResetMock = vi.fn();
const signOutMock = vi.fn();
const loginActionMock = vi.fn();
const replaceMock = vi.fn();

vi.mock("@/lib/admin/firebase/client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/admin/firebase/client")>();
  return {
    ...actual,
    loadAdminAuthClient: async () => ({
      signIn: (...args: unknown[]) => signInMock(...args),
      sendPasswordReset: (...args: unknown[]) => sendPasswordResetMock(...args),
      signOut: (...args: unknown[]) => signOutMock(...args),
    }),
  };
});

vi.mock("@/app/admin/login/actions", () => ({
  loginAction: (...args: unknown[]) => loginActionMock(...args),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock }),
}));

import { LoginForm } from "../app/admin/login/LoginForm";

const GENERIC_ERROR =
  "No pudimos iniciar sesión. Revisa tus datos e inténtalo de nuevo.";
const VERIFICATION_SENT =
  "Te enviamos un correo para verificar tu cuenta. Ábrelo y vuelve a iniciar sesión.";
const RESET_SENT =
  "Si el correo está registrado, recibirás un enlace para restablecer tu contraseña.";

function firebaseError(code: string) {
  return Object.assign(new Error(`Firebase: Error (${code}).`), { code });
}

function verifiedUser(idToken = "fresh-id-token") {
  return { emailVerified: true, idToken };
}

function unverifiedUser() {
  return {
    emailVerified: false,
    sendVerificationEmail: () => sendVerificationEmailMock(),
  };
}

function fillAndSubmit(email: string, password: string) {
  fireEvent.change(screen.getByLabelText("Correo"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("Contraseña"), {
    target: { value: password },
  });
  fireEvent.submit(screen.getByRole("button", { name: "Entrar" }).closest("form")!);
}

beforeEach(() => {
  vi.resetAllMocks();
  signOutMock.mockResolvedValue(undefined);
  sendPasswordResetMock.mockResolvedValue(undefined);
  sendVerificationEmailMock.mockResolvedValue(undefined);
});

describe("LoginForm — labels", () => {
  it("renders labelled email and password fields and a submit button", () => {
    render(<LoginForm />);

    expect(screen.getByLabelText("Correo")).toHaveAttribute("type", "email");
    expect(screen.getByLabelText("Contraseña")).toHaveAttribute("type", "password");
    expect(screen.getByRole("button", { name: "Entrar" })).toBeInTheDocument();
  });
});

describe("LoginForm — sign-in", () => {
  it("signs in, trades the ID token for the session cookie, signs out of Firebase and navigates to the panel", async () => {
    signInMock.mockResolvedValue(verifiedUser("fresh-id-token"));
    loginActionMock.mockResolvedValue({ ok: true });
    render(<LoginForm />);

    fillAndSubmit("  admin@example.com  ", "correct horse");

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/admin"));
    expect(signInMock).toHaveBeenCalledWith("admin@example.com", "correct horse");
    expect(loginActionMock).toHaveBeenCalledWith("fresh-id-token");
    expect(signOutMock).toHaveBeenCalledTimes(1);
    expect(sendVerificationEmailMock).not.toHaveBeenCalled();
  });

  it.each([
    "auth/invalid-credential",
    "auth/user-not-found",
    "auth/wrong-password",
    "auth/user-disabled",
    "auth/invalid-email",
    // Firebase throttles repeated wrong passwords per account, so a distinct
    // message for it would confirm that the address has an account.
    "auth/too-many-requests",
  ])(
    "shows the SAME generic message for %s, so it never reveals whether an email exists",
    async (code) => {
      signInMock.mockRejectedValue(firebaseError(code));
      render(<LoginForm />);

      fillAndSubmit("someone@example.com", "whatever");

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(GENERIC_ERROR);
      expect(loginActionMock).not.toHaveBeenCalled();
      expect(replaceMock).not.toHaveBeenCalled();
    },
  );

  it("shows the same generic message when the server rejects the token (e.g. not on the allowlist)", async () => {
    signInMock.mockResolvedValue(verifiedUser());
    loginActionMock.mockResolvedValue({ ok: false, error: "unauthorized" });
    render(<LoginForm />);

    fillAndSubmit("stranger@example.com", "pw");

    expect(await screen.findByRole("alert")).toHaveTextContent(GENERIC_ERROR);
    // The browser must not keep a Firebase session when the server said no.
    expect(signOutMock).toHaveBeenCalledTimes(1);
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("reports an unavailable service when the server could not create the session", async () => {
    signInMock.mockResolvedValue(verifiedUser());
    loginActionMock.mockResolvedValue({ ok: false, error: "server" });
    render(<LoginForm />);

    fillAndSubmit("admin@example.com", "pw");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "El servicio no está disponible",
    );
  });

  it("re-enables the form after a failure so the user can retry", async () => {
    signInMock.mockRejectedValue(firebaseError("auth/invalid-credential"));
    render(<LoginForm />);

    fillAndSubmit("admin@example.com", "wrong");
    await screen.findByRole("alert");

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Entrar" })).toBeEnabled(),
    );
  });
});

describe("LoginForm — unverified email (first login of a console-created user)", () => {
  it("sends the verification email, explains it, signs out, and never calls loginAction", async () => {
    signInMock.mockResolvedValue(unverifiedUser());
    render(<LoginForm />);

    fillAndSubmit("admin@example.com", "temporary-password");

    expect(await screen.findByRole("status")).toHaveTextContent(VERIFICATION_SENT);
    expect(sendVerificationEmailMock).toHaveBeenCalledTimes(1);
    expect(signOutMock).toHaveBeenCalledTimes(1);
    expect(loginActionMock).not.toHaveBeenCalled();
    expect(replaceMock).not.toHaveBeenCalled();
    // It is an instruction, not a failure.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("re-enables the form after the notice so the user can sign in again once verified", async () => {
    signInMock.mockResolvedValue(unverifiedUser());
    render(<LoginForm />);

    fillAndSubmit("admin@example.com", "temporary-password");
    await screen.findByRole("status");

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Entrar" })).toBeEnabled(),
    );
  });

  it("shows the existing generic error, still signs out and never calls loginAction when Firebase throttles the verification email", async () => {
    signInMock.mockResolvedValue(unverifiedUser());
    sendVerificationEmailMock.mockRejectedValue(
      firebaseError("auth/too-many-requests"),
    );
    render(<LoginForm />);

    fillAndSubmit("admin@example.com", "temporary-password");

    expect(await screen.findByRole("alert")).toHaveTextContent(GENERIC_ERROR);
    expect(screen.queryByText(VERIFICATION_SENT)).not.toBeInTheDocument();
    expect(signOutMock).toHaveBeenCalledTimes(1);
    expect(loginActionMock).not.toHaveBeenCalled();
  });

  it("shows the generic error when sending the verification email fails for any other reason", async () => {
    signInMock.mockResolvedValue(unverifiedUser());
    sendVerificationEmailMock.mockRejectedValue(firebaseError("auth/internal-error"));
    render(<LoginForm />);

    fillAndSubmit("admin@example.com", "temporary-password");

    expect(await screen.findByRole("alert")).toHaveTextContent(GENERIC_ERROR);
    expect(signOutMock).toHaveBeenCalledTimes(1);
    expect(loginActionMock).not.toHaveBeenCalled();
  });
});

describe("LoginForm — password reset", () => {
  it("sends the reset email for the typed address and confirms without saying whether it exists", async () => {
    render(<LoginForm />);

    fireEvent.change(screen.getByLabelText("Correo"), {
      target: { value: "admin@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Olvidé mi contraseña" }));

    expect(await screen.findByRole("status")).toHaveTextContent(RESET_SENT);
    expect(sendPasswordResetMock).toHaveBeenCalledWith("admin@example.com");
  });

  it.each(["auth/user-not-found", "auth/too-many-requests"])(
    "answers exactly like a success when Firebase reports %s, so neither existence nor throttling leaks",
    async (code) => {
      sendPasswordResetMock.mockRejectedValue(firebaseError(code));
      render(<LoginForm />);

      fireEvent.change(screen.getByLabelText("Correo"), {
        target: { value: "nobody@example.com" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Olvidé mi contraseña" }));

      expect(await screen.findByRole("status")).toHaveTextContent(RESET_SENT);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    },
  );

  it("asks for an email first when the field is empty, without calling Firebase", async () => {
    render(<LoginForm />);

    fireEvent.click(screen.getByRole("button", { name: "Olvidé mi contraseña" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Escribe tu correo");
    expect(sendPasswordResetMock).not.toHaveBeenCalled();
  });
});
