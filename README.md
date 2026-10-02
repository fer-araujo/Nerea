# nerea

Next.js storefront for a one-person artisanal jewelry atelier. Catalog and
content editing run on Sanity (bilingual, image/video-first); checkout runs on
Stripe; the private admin panel (`/admin`) and the contact-form inbox run on
Firebase (Auth + Firestore, server-side only). See
`openspec/changes/mvp-launch/` for the full proposal, design, and task
breakdown.

## Local development

```bash
npm install
cp env.example .env.local   # fill in Sanity/Stripe values, or leave
                             # COMMERCE_SOURCE=fixtures for credential-free dev
npm run dev
```

`.env.local` is git-ignored (see `.gitignore`) — never commit real
credentials. `env.example` documents every variable name only. (The file is
named `env.example`, not `.env.example`, because this environment's write
sandbox blocks writing any `.env*` file outright; rename it locally to
`.env.local` as shown above.)

## Environment variables

| Variable | Scope | Notes |
|---|---|---|
| `COMMERCE_SOURCE` | server-only | `sanity` (default — live catalog) or `fixtures` (no credentials required; dev/test-only, e.g. `COMMERCE_SOURCE=fixtures`). |
| `NEXT_PUBLIC_SANITY_PROJECT_ID` / `NEXT_PUBLIC_SANITY_DATASET` | public | Sanity project identifiers; fall back to the real project's values in `sanity/env.ts` when unset. |
| `NEXT_PUBLIC_SITE_URL` | public | Used for `metadataBase`, canonical/hreflang URLs, and the sitemap/robots routes; falls back to `http://localhost:3000` when unset. |
| `STRIPE_SECRET_KEY` | server-only | Stripe test-mode key for Checkout Sessions; never prefix `NEXT_PUBLIC_`. The app fails safe (never throws, never logs the key) when unset. |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | public | Stripe publishable key. |
| `STRIPE_WEBHOOK_SECRET` | server-only | Signing secret for the `checkout.session.completed` webhook (`app/api/stripe/webhook/route.ts`) that marks a purchased piece sold; never prefix `NEXT_PUBLIC_`. Unset or invalid signatures fail closed (400, nothing processed). |
| `SANITY_WRITE_TOKEN` | server-only | Write-capable token used by the Stripe webhook to mark a purchased piece `sold`; never prefix `NEXT_PUBLIC_`. The app fails safe (never throws, never logs the token) when unset. |
| `FIREBASE_PROJECT_ID` / `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY` | server-only | Firebase service account for the Admin SDK (Firestore + admin session cookies); never prefix `NEXT_PUBLIC_`. Unset or unusable: the contact form returns a server error and `/admin` login is refused (never throws, never logs the values). The private key may use literal `\n` sequences. |
| `ADMIN_EMAILS` | server-only | Comma-separated allowlist of emails that may enter `/admin` (case-insensitive). Empty or unset means nobody (fails closed). Read on every admin request (never cached), so a removal applies as soon as the new environment is live (on Netlify, after a redeploy). To cut someone off immediately, disable their user in Firebase Authentication: sessions are revocation-checked on every request. |
| `NEXT_PUBLIC_FIREBASE_API_KEY` / `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` / `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | public | Firebase web app config for the `/admin` login form. Public by design: it identifies the project and grants no access (Firestore rules deny all clients; the server enforces the allowlist). |

`COMMERCE_SOURCE=fixtures` is a dev/test-only override: it swaps in 3 local,
credential-free sample products (`lib/commerce/fixtures.ts`) so the app runs
before — or without — the live Sanity project. It is never used in
production.

## Admin panel and Firebase setup

`/admin` is a Spanish-only panel for the atelier (separate root layout, not
locale-routed, `noindex`). Contact-form messages land in Firestore and are read
in **Mensajes**. Everything touching Firebase Admin is server-only, and
Firestore is never reachable from the browser. One-time setup:

1. In the [Firebase console](https://console.firebase.google.com), create a
   project (Spark plan is enough) and add a **Web app** (Project settings >
   Your apps). Copy its `apiKey`, `authDomain` and `projectId` into
   `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` and
   `NEXT_PUBLIC_FIREBASE_PROJECT_ID`.
2. **Authentication > Sign-in method:** enable **Email/Password** (and only
   that provider).
3. **Authentication > Users:** add the admin user (email + a temporary
   password) and put that email in `ADMIN_EMAILS`.
4. **Firestore Database:** create it in **production mode**, then open the
   **Rules** tab, paste the contents of [`firestore.rules`](firestore.rules)
   (deny all client reads and writes) and publish. The server uses the Admin
   SDK, which is not subject to these rules.
5. **Project settings > Service accounts > Generate new private key.** Copy
   `project_id`, `client_email` and `private_key` into `FIREBASE_PROJECT_ID`,
   `FIREBASE_CLIENT_EMAIL` and `FIREBASE_PRIVATE_KEY` (`.env.local` locally, the
   host's environment variables in production), then **delete the downloaded
   JSON file** — it is a full-access credential.
6. First sign-in: the panel only admits users whose email is **verified**
   (the server enforces this), and users created in the console start
   unverified. The login form handles it: sign in once at `/admin/login` with
   the temporary password and, instead of entering, you get "Te enviamos un
   correo para verificar tu cuenta…" and Firebase sends the verification email
   (check spam). Open it, click the link, then sign in again. Afterwards
   **Olvidé mi contraseña** lets her choose her own password.

Sessions last 5 days (httpOnly, `SameSite=Strict` cookie scoped to `/admin`,
revocation-checked on every request). Signing out revokes the user's Firebase
refresh tokens, which ends the session on every device.

## Testing

```bash
npm run test
```

Vitest is configured for targeted unit tests only (see `design.md`'s Testing
Strategy) — no broader test framework is set up beyond what each day's tasks
need.

## Deployment (Vercel)

TODO (manual, client-owned step — requires the client's Vercel account):
connect this GitHub repo to a Vercel project via the Vercel dashboard so that
feature-branch pushes generate preview deployments and `main` stays untouched
until an approved PR merge. No `vercel` CLI login/deploy was run from this
environment.
