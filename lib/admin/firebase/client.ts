// Browser-side Firebase Auth, used ONLY by the admin login form
// (app/admin/login/LoginForm.tsx). The browser's whole job is to prove who the
// user is once: sign in, hand the resulting ID token to the server (which
// mints the httpOnly session cookie), then sign out again. A user whose email
// isn't verified yet gets no token at all: users created in the Firebase
// console start unverified, and the server refuses unverified emails, so the
// form sends Firebase's verification email instead of attempting a login that
// is bound to fail.
//
// - The config below is PUBLIC by design (NEXT_PUBLIC_*): Firebase web API keys
//   identify the project, they don't grant access; access is enforced by
//   Firebase Auth itself plus the server-side allowlist in
//   lib/admin/auth/session.ts. No secret ever belongs in this file.
// - `inMemoryPersistence`: the signed-in user is never written to
//   localStorage/IndexedDB, so nothing token-like outlives the page.
// - The SDK is imported LAZILY (dynamic import, on first use). The login page
//   itself stays light, and the SDK is never evaluated during server
//   rendering — this module only has type-only imports at the top level.
import type { Auth } from "firebase/auth";

export type AdminSignInResult =
  /** Verified email: carries a fresh ID token to trade for the session cookie. */
  | { emailVerified: true; idToken: string }
  /**
   * Unverified email: no token is issued. `sendVerificationEmail` is bound to
   * the user who just signed in (Firebase rate-limits it, so it can reject
   * with `auth/too-many-requests`).
   */
  | { emailVerified: false; sendVerificationEmail(): Promise<void> };

export interface AdminAuthClient {
  /** Signs in with email + password; rejects with a FirebaseError on failure. */
  signIn(email: string, password: string): Promise<AdminSignInResult>;
  sendPasswordReset(email: string): Promise<void>;
  signOut(): Promise<void>;
}

async function createAdminAuthClient(): Promise<AdminAuthClient | undefined> {
  // Literal `process.env.NEXT_PUBLIC_*` reads on purpose: Next.js inlines
  // these at build time only in this exact form.
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!apiKey || !authDomain || !projectId) {
    return undefined;
  }

  const [appSdk, authSdk] = await Promise.all([
    import("firebase/app"),
    import("firebase/auth"),
  ]);

  const app =
    appSdk.getApps().length > 0
      ? appSdk.getApp()
      : appSdk.initializeApp({ apiKey, authDomain, projectId });

  // Idempotent for identical options, so a Fast Refresh re-evaluation of this
  // module gets the existing instance back instead of throwing.
  const auth: Auth = authSdk.initializeAuth(app, {
    persistence: authSdk.inMemoryPersistence,
  });

  return {
    async signIn(email, password) {
      const { user } = await authSdk.signInWithEmailAndPassword(
        auth,
        email,
        password,
      );

      if (!user.emailVerified) {
        return {
          emailVerified: false,
          sendVerificationEmail: () => authSdk.sendEmailVerification(user),
        };
      }

      return { emailVerified: true, idToken: await user.getIdToken() };
    },
    sendPasswordReset(email) {
      return authSdk.sendPasswordResetEmail(auth, email);
    },
    signOut() {
      return authSdk.signOut(auth);
    },
  };
}

let clientPromise: Promise<AdminAuthClient | undefined> | undefined;

/**
 * Loads (once) and returns the Firebase Auth client, or `undefined` when the
 * NEXT_PUBLIC_FIREBASE_* variables aren't set. Safe to call early — e.g. on
 * field focus — to warm the SDK chunk before the user submits.
 */
export function loadAdminAuthClient(): Promise<AdminAuthClient | undefined> {
  if (!clientPromise) {
    clientPromise = createAdminAuthClient().catch((error: unknown) => {
      // A failed chunk load must not be cached forever; let the next call retry.
      clientPromise = undefined;
      throw error;
    });
  }
  return clientPromise;
}

/** The Firebase error code (e.g. "auth/too-many-requests"), if the error has one. */
export function getAuthErrorCode(error: unknown): string | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return undefined;
}
