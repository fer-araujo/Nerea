"use server";

import { headers } from "next/headers";
import { getSanityWriteClient } from "./write-client";
import { isRateLimited } from "./rate-limit";
import { validateContactInput } from "./validate";

export interface SubmitContactInput {
  name: string;
  email: string;
  message: string;
  /**
   * Honeypot field. A real visitor never fills it (hidden off-screen,
   * aria-hidden, unreachable by keyboard — see ContactForm.tsx); a filled
   * value is treated as an automated submission.
   */
  honeypot: string;
}

export type SubmitContactResult =
  | { ok: true }
  | { ok: false; error: "validation" | "rate_limit" | "server" };

// Rate-limit key = the client IP, taken ONLY from a header the platform sets
// and the caller cannot forge. On Vercel, `x-real-ip` is set by the edge to
// the real client IP. We deliberately do NOT read `x-forwarded-for`: its
// leftmost entry is client-appendable, so keying the limiter on it lets an
// attacker send a fresh spoofed value per request and bypass the limit
// entirely (a confirmed bypass — see security review). When no trusted header
// is present (local dev, or a platform that doesn't set it) we fall back to a
// single shared bucket, so unattributable requests are limited COLLECTIVELY
// (fails closed) rather than each getting a free pass.
async function resolveClientIp(): Promise<string> {
  const headerList = await headers();

  const realIp = headerList.get("x-real-ip")?.trim();
  if (realIp) {
    return realIp;
  }

  return "unknown";
}

/**
 * Server Action backing ContactForm. Order of guards is deliberate: the
 * honeypot check runs FIRST and short-circuits before touching the rate
 * limiter, so a bot hammering the honeypot can never burn through the
 * rate-limit window of a legitimate visitor sharing the same IP/NAT.
 *
 * Wrapped end-to-end in try/catch so this action can never throw uncaught —
 * every branch, including an unexpected failure, resolves to a typed
 * result. Never logs the caught error (it could embed user input) and never
 * echoes any part of the input back in a result.
 */
export async function submitContact(
  input: SubmitContactInput,
): Promise<SubmitContactResult> {
  try {
    if (input.honeypot) {
      return { ok: true };
    }

    const ip = await resolveClientIp();
    if (isRateLimited(ip)) {
      return { ok: false, error: "rate_limit" };
    }

    const validated = validateContactInput(input);
    if (!validated) {
      return { ok: false, error: "validation" };
    }

    const client = getSanityWriteClient();
    if (!client) {
      return { ok: false, error: "server" };
    }

    await client.create({
      _type: "contactMessage",
      name: validated.name,
      email: validated.email,
      message: validated.message,
      // Server-generated timestamp — never trust a client-supplied time.
      createdAt: new Date().toISOString(),
    });

    return { ok: true };
  } catch {
    return { ok: false, error: "server" };
  }
}
