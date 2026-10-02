"use server";

import {
  createAdminSession,
  type CreateAdminSessionResult,
} from "@/lib/admin/auth/session";

export type LoginResult = CreateAdminSessionResult;

// A Firebase ID token is a ~1 KB JWT (a few KB with custom claims). The bound
// only stops absurd payloads from reaching the verifier; it is not a security
// control by itself — verifyIdToken() is.
const MAX_ID_TOKEN_LENGTH = 4096;

/**
 * Login Server Action. The one admin action that cannot call requireAdmin():
 * its job is to create the session. Its gate is the validation below plus
 * createAdminSession(), which verifies the token with Firebase, then requires
 * a verified email on the ADMIN_EMAILS allowlist and a very recent sign-in.
 *
 * The parameter is typed `unknown` on purpose: a Server Action is a public
 * POST endpoint, so TypeScript's declared types say nothing about what
 * actually arrives. Every rejection returns the same generic result.
 */
export async function loginAction(idToken: unknown): Promise<LoginResult> {
  if (
    typeof idToken !== "string" ||
    idToken.length === 0 ||
    idToken.length > MAX_ID_TOKEN_LENGTH
  ) {
    return { ok: false, error: "unauthorized" };
  }

  return createAdminSession(idToken);
}
