import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { DecodedIdToken } from "firebase-admin/auth";
import { getAdminAuth } from "@/lib/admin/firebase/admin";

// Admin session = a Firebase *session cookie* (not the short-lived ID token),
// minted server-side after the browser signs in with Firebase Auth. Flow:
//   client sign-in -> ID token -> createAdminSession() -> httpOnly cookie
//   every request  -> requireAdmin() -> verifySessionCookie(cookie, true)
// Everything here runs in the Node runtime ONLY. It must never be imported by
// middleware (Edge on Netlify) or by a Client Component — `server-only` makes
// that a build error. And no code path in this file logs a token, an email
// or any message content.

export const SESSION_COOKIE_NAME = "nerea_admin_session";
// Scoped to /admin so the cookie is never sent with storefront requests.
export const SESSION_COOKIE_PATH = "/admin";
export const LOGIN_PATH = "/admin/login";

const SESSION_MAX_AGE_SECONDS = 5 * 24 * 60 * 60;

// Firebase's own guidance for minting a session cookie: only do it for a user
// who authenticated moments ago, so a stolen-but-old ID token can't be traded
// for a 5-day session.
const MAX_SIGN_IN_AGE_SECONDS = 5 * 60;

export interface AdminUser {
  uid: string;
  email: string;
}

// `unauthorized` deliberately covers every rejection reason (bad token,
// unverified email, not allowlisted, stale sign-in) so a caller — and
// therefore the browser — can never tell WHICH check failed; that would let
// anyone probe which emails are admins. `server` = Firebase not configured or
// an unexpected failure.
export type CreateAdminSessionResult =
  | { ok: true }
  | { ok: false; error: "unauthorized" | "server" };

// ADMIN_EMAILS is read at CALL time (not cached at module load), so no code
// path can hold on to a stale list: a removal applies as soon as the process
// environment does (on Netlify that means a new deploy). For an immediate
// lock-out, disable the user in Firebase Authentication instead — sessions
// are revocation-checked on every request. Empty/unset means nobody — fail
// closed.
function readAllowlist(): Set<string> {
  return new Set(
    (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0),
  );
}

function isAllowlisted(
  email: string | undefined,
  allowlist: Set<string>,
): email is string {
  return email !== undefined && allowlist.has(email.trim().toLowerCase());
}

function signedInRecently(authTime: unknown): boolean {
  if (typeof authTime !== "number") {
    return false;
  }
  const ageSeconds = Math.floor(Date.now() / 1000) - authTime;
  // NaN fails the comparison, so a malformed claim is rejected too.
  return ageSeconds <= MAX_SIGN_IN_AGE_SECONDS;
}

/**
 * Exchanges a freshly issued Firebase ID token for the admin session cookie.
 * Called ONLY from the login Server Action. Never throws: every outcome —
 * including an unexpected failure — resolves to a typed result.
 */
export async function createAdminSession(
  idToken: string,
): Promise<CreateAdminSessionResult> {
  try {
    const allowlist = readAllowlist();
    // Cheap synchronous gate first: with nobody allowlisted no token can ever
    // succeed, so skip the Firebase round trips entirely.
    if (allowlist.size === 0) {
      return { ok: false, error: "unauthorized" };
    }

    const auth = getAdminAuth();
    if (!auth) {
      return { ok: false, error: "server" };
    }

    let decoded: DecodedIdToken;
    try {
      // `true` also rejects tokens whose refresh token was revoked.
      decoded = await auth.verifyIdToken(idToken, true);
    } catch {
      return { ok: false, error: "unauthorized" };
    }

    if (
      decoded.email_verified !== true ||
      !isAllowlisted(decoded.email, allowlist) ||
      !signedInRecently(decoded.auth_time)
    ) {
      return { ok: false, error: "unauthorized" };
    }

    const sessionCookie = await auth.createSessionCookie(idToken, {
      expiresIn: SESSION_MAX_AGE_SECONDS * 1000,
    });

    const cookieStore = await cookies();
    cookieStore.set(SESSION_COOKIE_NAME, sessionCookie, {
      httpOnly: true,
      // Secure only in production so plain-http local development can still
      // sign in; every deployed environment is https.
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: SESSION_COOKIE_PATH,
      maxAge: SESSION_MAX_AGE_SECONDS,
    });

    return { ok: true };
  } catch {
    return { ok: false, error: "server" };
  }
}

async function readSessionCookie(): Promise<string | undefined> {
  const cookieStore = await cookies();
  return cookieStore.get(SESSION_COOKIE_NAME)?.value;
}

/**
 * The signed-in admin, or `null`. For Route Handlers (which answer 401, not a
 * redirect) and for pages that branch on "already signed in".
 *
 * Verification is FULL on every call, never trusted from the cookie alone:
 *   - `verifySessionCookie(cookie, true)` checks signature, expiry AND that
 *     the user's refresh tokens haven't been revoked or the account disabled;
 *   - the allowlist is re-read, so an email deleted from ADMIN_EMAILS is cut
 *     off on the very next request once that environment change is live.
 *
 * Wrapped in React `cache()`: while a single page render asks several times
 * (layout + page) the check runs once. `cache()` is scoped to one render, so
 * it can never carry a verdict from one request to another, and inside a
 * Server Action (outside a render) it is a pass-through — every action
 * re-verifies from scratch.
 */
export const getAdminOrNull = cache(async (): Promise<AdminUser | null> => {
  const sessionCookie = await readSessionCookie();
  if (!sessionCookie) {
    return null;
  }

  const allowlist = readAllowlist();
  if (allowlist.size === 0) {
    return null;
  }

  const auth = getAdminAuth();
  if (!auth) {
    return null;
  }

  let decoded: DecodedIdToken;
  try {
    decoded = await auth.verifySessionCookie(sessionCookie, true);
  } catch {
    return null;
  }

  if (decoded.email_verified !== true || !isAllowlisted(decoded.email, allowlist)) {
    return null;
  }

  return { uid: decoded.uid, email: decoded.email };
});

/**
 * Gate for layouts, pages and Server Actions: returns the admin or redirects
 * to the login page. Layouts do NOT protect Server Actions (an action is a
 * public POST endpoint) and pages render in parallel with their layout, so
 * every action — and every page that reads data — calls this itself, FIRST.
 */
export async function requireAdmin(): Promise<AdminUser> {
  const admin = await getAdminOrNull();
  if (!admin) {
    redirect(LOGIN_PATH);
  }
  return admin;
}

/**
 * Ends the current admin session: drops the cookie and revokes the user's
 * Firebase refresh tokens, which invalidates this session cookie server-side
 * (it is verified with `checkRevoked` on every request) and any other device's
 * session for the same account.
 */
export async function signOutAdmin(): Promise<void> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  // Drop the cookie FIRST: ending the browser session must not depend on
  // Firebase being reachable. The path must match the one it was set with.
  cookieStore.delete({ name: SESSION_COOKIE_NAME, path: SESSION_COOKIE_PATH });

  if (!sessionCookie) {
    return;
  }

  try {
    const auth = getAdminAuth();
    if (!auth) {
      return;
    }
    // No revocation check here: only the uid is needed, and the signature /
    // expiry check is enough to trust it (and keeps sign-out to one network
    // call). The uid always comes from the caller's own cookie, never from
    // request input.
    const decoded = await auth.verifySessionCookie(sessionCookie, false);
    await auth.revokeRefreshTokens(decoded.uid);
  } catch {
    // Expired/invalid cookie (nothing left to revoke) or Firebase
    // unreachable. The cookie is already gone from the browser; the error is
    // deliberately not logged, it could carry token material.
  }
}
