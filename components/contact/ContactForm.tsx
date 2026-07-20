"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { submitContact, type SubmitContactResult } from "@/lib/contact/submit";

type Status = "idle" | "submitting" | "success" | "error";
type ErrorKind = Exclude<SubmitContactResult, { ok: true }>["error"];

const ERROR_MESSAGE_KEY: Record<ErrorKind, string> = {
  validation: "errorValidation",
  rate_limit: "errorRateLimit",
  server: "errorServer",
};

// Contact form wired to the submitContact Server Action (lib/contact/submit.ts):
// strict server-side validation, a honeypot, and per-IP rate limiting all live
// there — this component only handles submit/pending/success/error UI. A
// trivial `mailto:` submission was considered and rejected: the atelier's real
// contact address isn't confirmed yet (proposal.md — open dependencies), and a
// fabricated address as a live mailto link risks reading as real, working
// contact info on a client preview instead of the draft it is.
export function ContactForm() {
  const t = useTranslations("Contact");
  const [status, setStatus] = useState<Status>("idle");
  const [errorKind, setErrorKind] = useState<ErrorKind | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === "submitting") return;

    const form = event.currentTarget;
    const data = new FormData(form);

    setStatus("submitting");
    setErrorKind(null);

    const result = await submitContact({
      name: String(data.get("name") ?? ""),
      email: String(data.get("email") ?? ""),
      message: String(data.get("message") ?? ""),
      honeypot: String(data.get("honeypot") ?? ""),
    });

    if (result.ok) {
      form.reset();
      setStatus("success");
      return;
    }

    setErrorKind(result.error);
    setStatus("error");
  }

  if (status === "success") {
    return (
      <div
        role="status"
        aria-live="polite"
        className="border border-line bg-bone-raised px-6 py-8"
      >
        <p className="font-display text-xl text-ink">{t("successTitle")}</p>
        <p className="mt-2 text-graphite">{t("successBody")}</p>
      </div>
    );
  }

  const isSubmitting = status === "submitting";

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      {/* Honeypot — hidden from sighted and keyboard users; a filled value
          marks the submission as automated (see lib/contact/submit.ts). Off-
          canvas positioning (not `hidden`/`display:none`) plus aria-hidden,
          a negative tabIndex, and autoComplete="off" keep it unreachable and
          unfilled for real visitors while still present in the DOM for a
          scripted bot to (wrongly) fill. Not translated: it must never be
          perceived as real UI copy by anyone reviewing the app's strings. */}
      <div
        aria-hidden="true"
        style={{ position: "absolute", left: "-9999px", top: 0, height: 0, width: 0, overflow: "hidden" }}
      >
        <label>
          Company
          <input type="text" name="honeypot" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      <label className="flex flex-col gap-2">
        <span className="font-mono text-xs uppercase tracking-[0.14em] text-graphite">
          {t("nameLabel")}
        </span>
        <input
          type="text"
          name="name"
          required
          maxLength={80}
          autoComplete="name"
          disabled={isSubmitting}
          placeholder={t("namePlaceholder")}
          className="w-full appearance-none rounded-none border border-line bg-bone-raised px-4 py-3 font-sans text-sm text-ink placeholder:text-graphite/60 disabled:cursor-not-allowed disabled:opacity-60"
        />
      </label>

      <label className="flex flex-col gap-2">
        <span className="font-mono text-xs uppercase tracking-[0.14em] text-graphite">
          {t("emailLabel")}
        </span>
        <input
          type="email"
          name="email"
          required
          maxLength={160}
          autoComplete="email"
          disabled={isSubmitting}
          placeholder={t("emailPlaceholder")}
          className="w-full appearance-none rounded-none border border-line bg-bone-raised px-4 py-3 font-sans text-sm text-ink placeholder:text-graphite/60 disabled:cursor-not-allowed disabled:opacity-60"
        />
      </label>

      <label className="flex flex-col gap-2">
        <span className="font-mono text-xs uppercase tracking-[0.14em] text-graphite">
          {t("messageLabel")}
        </span>
        <textarea
          name="message"
          required
          maxLength={2000}
          rows={5}
          disabled={isSubmitting}
          placeholder={t("messagePlaceholder")}
          className="w-full resize-y appearance-none rounded-none border border-line bg-bone-raised px-4 py-3 font-sans text-sm text-ink placeholder:text-graphite/60 disabled:cursor-not-allowed disabled:opacity-60"
        />
      </label>

      {status === "error" && errorKind ? (
        <p
          role="alert"
          className="border border-ink/25 bg-bone-sunk px-4 py-3 font-mono text-xs leading-relaxed text-ink"
        >
          {t(ERROR_MESSAGE_KEY[errorKind])}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={isSubmitting}
        className="inline-flex w-full items-center justify-center border border-ink bg-ink px-7 py-3.5 font-sans text-sm text-bone transition-colors duration-200 hover:border-brass-deep hover:bg-brass-deep disabled:cursor-not-allowed disabled:opacity-60 sm:w-fit"
      >
        {isSubmitting ? t("submitting") : t("submit")}
      </button>
    </form>
  );
}
