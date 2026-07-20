# nerea

Next.js storefront for a one-person artisanal jewelry atelier. Catalog and
admin run on Sanity (bilingual, image/video-first); checkout runs on Stripe.
See `openspec/changes/mvp-launch/` for the full proposal, design, and task
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
| `SANITY_WRITE_TOKEN` | server-only | Write-capable token the contact form uses to store `contactMessage` documents; never prefix `NEXT_PUBLIC_`. The app fails safe (returns a generic error, never throws, never logs the token) when unset. |

`COMMERCE_SOURCE=fixtures` is a dev/test-only override: it swaps in 3 local,
credential-free sample products (`lib/commerce/fixtures.ts`) so the app runs
before — or without — the live Sanity project. It is never used in
production.

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
