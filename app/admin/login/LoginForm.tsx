"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  getAuthErrorCode,
  loadAdminAuthClient,
} from "@/lib/admin/firebase/client";
import { loginAction, type LoginResult } from "./actions";

type Status = "idle" | "signing-in" | "sending-reset";
type Notice = { kind: "error" | "info"; text: string };

// The panel is a single-language (Spanish) surface that lives outside the
// [locale] tree, so its copy is plain constants rather than next-intl
// messages. Error copy is deliberately generic: nothing here may reveal
// whether an email address has an account or is an admin.
const COPY = {
  emailLabel: "Correo",
  passwordLabel: "Contraseña",
  submit: "Entrar",
  submitting: "Entrando…",
  forgot: "Olvidé mi contraseña",
  sendingReset: "Enviando enlace…",
  errorGeneric:
    "No pudimos iniciar sesión. Revisa tus datos e inténtalo de nuevo.",
  verificationSent:
    "Te enviamos un correo para verificar tu cuenta. Ábrelo y vuelve a iniciar sesión.",
  errorUnavailable:
    "El servicio no está disponible por ahora. Inténtalo de nuevo en unos minutos.",
  resetNeedsEmail: "Escribe tu correo para enviarte el enlace de recuperación.",
  resetInvalidEmail: "Escribe un correo válido.",
  resetSent:
    "Si el correo está registrado, recibirás un enlace para restablecer tu contraseña.",
} as const;

const LABEL_CLASS =
  "font-mono text-xs uppercase tracking-[0.14em] text-graphite";
const INPUT_CLASS =
  "w-full appearance-none rounded-none border border-line bg-bone-raised px-4 py-3 font-sans text-sm text-ink placeholder:text-graphite/60 disabled:cursor-not-allowed disabled:opacity-60";

function signInErrorText(error: unknown): string {
  switch (getAuthErrorCode(error)) {
    case "auth/network-request-failed":
      return COPY.errorUnavailable;
    default:
      // invalid-credential, user-not-found, wrong-password, user-disabled,
      // invalid-email, ... and ALSO auth/too-many-requests (whether raised by
      // the sign-in itself or by sending the verification email): ONE message
      // for all of them, so the form never tells an attacker whether an
      // address has an account. Firebase throttles repeated wrong passwords
      // per account, so a distinct "too many attempts" message would confirm
      // that the address exists.
      return COPY.errorGeneric;
  }
}

function resetNotice(error: unknown): Notice {
  switch (getAuthErrorCode(error)) {
    case "auth/user-not-found":
    case "auth/too-many-requests":
      // user-not-found is only thrown when Firebase's email-enumeration
      // protection is OFF; a throttle can trip on a per-address limit, i.e.
      // only for an address that exists. Either way, answer exactly like the
      // success case so existence never leaks.
      return { kind: "info", text: COPY.resetSent };
    case "auth/invalid-email":
      // Purely about the syntax of what was typed, not about any account.
      return { kind: "error", text: COPY.resetInvalidEmail };
    default:
      return { kind: "error", text: COPY.errorUnavailable };
  }
}

// Sign-in is a three-party handshake and this component only orchestrates it:
//   1. Firebase (browser) verifies email + password and issues an ID token;
//   2. the loginAction Server Action trades that token for the httpOnly
//      session cookie after the server-side checks (see session.ts);
//   3. the browser signs out of Firebase again — it keeps no session of its
//      own, the cookie is the only credential.
// If step 1 reports an UNVERIFIED email (every user created in the Firebase
// console starts that way), step 2 is skipped — the server would refuse it —
// and Firebase's verification email is sent instead; the user opens it and
// signs in again. Password reset goes straight to Firebase's own email flow.
export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [notice, setNotice] = useState<Notice | null>(null);

  const busy = status !== "idle";

  function warmUpFirebase() {
    // Start fetching the Firebase SDK chunk as soon as the user touches the
    // form, so submitting doesn't wait on a download.
    loadAdminAuthClient().catch(() => undefined);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    const password = String(
      new FormData(event.currentTarget).get("password") ?? "",
    );
    const trimmedEmail = email.trim();

    setStatus("signing-in");
    setNotice(null);

    try {
      const client = await loadAdminAuthClient();
      if (!client) {
        setNotice({ kind: "error", text: COPY.errorUnavailable });
        setStatus("idle");
        return;
      }

      let outcome:
        | { kind: "verification-sent" }
        | { kind: "login"; result: LoginResult };
      try {
        const signedIn = await client.signIn(trimmedEmail, password);

        if (signedIn.emailVerified) {
          outcome = {
            kind: "login",
            result: await loginAction(signedIn.idToken),
          };
        } else {
          // Console-created users start unverified and the server would
          // refuse them, so loginAction is NOT called: send the verification
          // email and let the user come back after opening it.
          await signedIn.sendVerificationEmail();
          outcome = { kind: "verification-sent" };
        }
      } finally {
        // Whatever happened, leave no Firebase session behind in the page.
        await client.signOut().catch(() => undefined);
      }

      if (outcome.kind === "verification-sent") {
        setNotice({ kind: "info", text: COPY.verificationSent });
      } else if (outcome.result.ok) {
        // Stay in the "signing-in" state: the navigation unmounts this form.
        router.replace("/admin");
        return;
      } else {
        setNotice({
          kind: "error",
          text:
            outcome.result.error === "server"
              ? COPY.errorUnavailable
              : COPY.errorGeneric,
        });
      }
    } catch (error) {
      setNotice({ kind: "error", text: signInErrorText(error) });
    }

    setStatus("idle");
  }

  async function handleReset() {
    if (busy) return;

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setNotice({ kind: "error", text: COPY.resetNeedsEmail });
      return;
    }

    setStatus("sending-reset");
    setNotice(null);

    try {
      const client = await loadAdminAuthClient();
      if (!client) {
        setNotice({ kind: "error", text: COPY.errorUnavailable });
      } else {
        await client.sendPasswordReset(trimmedEmail);
        setNotice({ kind: "info", text: COPY.resetSent });
      }
    } catch (error) {
      setNotice(resetNotice(error));
    }

    setStatus("idle");
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-busy={busy}
      className="flex flex-col gap-6"
    >
      <label className="flex flex-col gap-2">
        <span className={LABEL_CLASS}>{COPY.emailLabel}</span>
        <input
          type="email"
          name="email"
          required
          maxLength={160}
          autoComplete="username"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          onFocus={warmUpFirebase}
          disabled={busy}
          className={INPUT_CLASS}
        />
      </label>

      <label className="flex flex-col gap-2">
        <span className={LABEL_CLASS}>{COPY.passwordLabel}</span>
        <input
          type="password"
          name="password"
          required
          autoComplete="current-password"
          onFocus={warmUpFirebase}
          disabled={busy}
          className={INPUT_CLASS}
        />
      </label>

      {notice ? (
        <p
          role={notice.kind === "error" ? "alert" : "status"}
          className={
            notice.kind === "error"
              ? "border border-ink/25 bg-bone-sunk px-4 py-3 font-mono text-xs leading-relaxed text-ink"
              : "border border-line bg-bone-raised px-4 py-3 font-mono text-xs leading-relaxed text-ink"
          }
        >
          {notice.text}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={busy}
        className="inline-flex min-h-11 w-full items-center justify-center border border-ink bg-ink px-7 py-3.5 font-sans text-sm text-bone transition-colors duration-200 hover:border-brass-deep hover:bg-brass-deep disabled:cursor-not-allowed disabled:opacity-60"
      >
        {status === "signing-in" ? COPY.submitting : COPY.submit}
      </button>

      <button
        type="button"
        onClick={handleReset}
        disabled={busy}
        className="min-h-11 self-start font-sans text-sm text-graphite underline decoration-line underline-offset-4 transition-colors hover:text-brass-deep disabled:cursor-not-allowed disabled:opacity-60"
      >
        {status === "sending-reset" ? COPY.sendingReset : COPY.forgot}
      </button>
    </form>
  );
}
