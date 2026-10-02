import "server-only";
import {
  cert,
  getApp,
  getApps,
  initializeApp,
  type App,
} from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

// Server-only Firebase Admin SDK init (Auth session cookies + Firestore). The
// `server-only` import above turns any accidental import from a Client
// Component or from middleware into a build error: the service-account
// private key must never reach the browser bundle or the Edge runtime.
//
// Initialised LAZILY, only the first time Auth or Firestore is actually
// requested — never at module import time — and fails safe exactly like
// getStripeClient() in lib/commerce/stripe/client.ts: with the service-account
// variables unset (`next build` with no credentials, or local dev before the
// Firebase project exists) every getter returns `undefined` and the caller
// turns that into a normal, typed failure. Nothing here ever prints a
// credential or any derivative of one.
let cachedApp: App | undefined;
let warnedInvalidCredentials = false;

// Hosts and .env parsers commonly hand the PEM over with literal "\n"
// sequences instead of real newlines, and sometimes keep the wrapping quotes
// of the JSON service-account file. Restore the real PEM before `cert()`.
function normalizePrivateKey(raw: string): string {
  const unquoted =
    raw.length > 1 && raw.startsWith('"') && raw.endsWith('"')
      ? raw.slice(1, -1)
      : raw;
  return unquoted.replace(/\\n/g, "\n");
}

function getAdminApp(): App | undefined {
  if (cachedApp) {
    return cachedApp;
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;
  if (!projectId || !clientEmail || !privateKey) {
    return undefined;
  }

  try {
    // `getApps()` also covers dev Fast Refresh: this module can be
    // re-evaluated while firebase-admin (an external package) keeps its app
    // registry, and a second `initializeApp()` for the default app would throw.
    cachedApp =
      getApps().length > 0
        ? getApp()
        : initializeApp({
            credential: cert({
              projectId,
              clientEmail,
              privateKey: normalizePrivateKey(privateKey),
            }),
          });
  } catch {
    // Credentials are set but unusable (typically a mangled private key).
    // Same outcome as "unset" — fail closed, never throw — but leave ONE
    // fixed-string hint so a broken deployment isn't completely silent. The
    // caught error is deliberately not logged: it could echo key material.
    if (!warnedInvalidCredentials) {
      warnedInvalidCredentials = true;
      console.error(
        "[admin] Firebase Admin credentials are set but could not be used; check FIREBASE_* variables.",
      );
    }
    return undefined;
  }

  return cachedApp;
}

export function getAdminAuth(): Auth | undefined {
  const app = getAdminApp();
  return app ? getAuth(app) : undefined;
}

export function getAdminDb(): Firestore | undefined {
  const app = getAdminApp();
  return app ? getFirestore(app) : undefined;
}
