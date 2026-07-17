"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";

// Presentational-only contact form (MVP scope: no email/API backend — see
// tasks.md 4.13). On submit it never sends a network request; it swaps to a
// localized inline confirmation, entirely client-side. A trivial `mailto:`
// submission was considered and rejected: the atelier's real contact address
// isn't confirmed yet (proposal.md — open dependencies), and shipping a
// fabricated address as a live mailto link risks reading as real, working
// contact info on a client preview instead of the draft it is. KNOWN GAP:
// because this is a no-op, no message is actually delivered anywhere yet —
// this must be wired to a real handler (email service, Sanity mutation, or a
// simple API route) before Contact is treated as functional, not just
// visually complete.
export function ContactForm() {
  const t = useTranslations("Contact");
  const [submitted, setSubmitted] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
  }

  if (submitted) {
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

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <label className="flex flex-col gap-2">
        <span className="font-mono text-xs uppercase tracking-[0.14em] text-graphite">
          {t("nameLabel")}
        </span>
        <input
          type="text"
          name="name"
          required
          autoComplete="name"
          placeholder={t("namePlaceholder")}
          className="w-full appearance-none rounded-none border border-line bg-bone-raised px-4 py-3 font-sans text-sm text-ink placeholder:text-graphite/60"
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
          autoComplete="email"
          placeholder={t("emailPlaceholder")}
          className="w-full appearance-none rounded-none border border-line bg-bone-raised px-4 py-3 font-sans text-sm text-ink placeholder:text-graphite/60"
        />
      </label>

      <label className="flex flex-col gap-2">
        <span className="font-mono text-xs uppercase tracking-[0.14em] text-graphite">
          {t("messageLabel")}
        </span>
        <textarea
          name="message"
          required
          rows={5}
          placeholder={t("messagePlaceholder")}
          className="w-full resize-y appearance-none rounded-none border border-line bg-bone-raised px-4 py-3 font-sans text-sm text-ink placeholder:text-graphite/60"
        />
      </label>

      <button
        type="submit"
        className="inline-flex w-full items-center justify-center border border-ink bg-ink px-7 py-3.5 font-sans text-sm text-bone transition-colors duration-200 hover:border-brass-deep hover:bg-brass-deep sm:w-fit"
      >
        {t("submit")}
      </button>
    </form>
  );
}
