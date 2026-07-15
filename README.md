# nerea

Headless Shopify + Next.js storefront. See `openspec/changes/mvp-launch/` for
the full proposal, design, and task breakdown.

## Local development

```bash
npm install
cp env.example .env.local   # fill in Shopify values once the store exists
npm run dev
```

`.env.local` is git-ignored (see `.gitignore`) — never commit real Shopify
credentials. `env.example` documents the two required variable names only.
(The file is named `env.example`, not `.env.example`, because this
environment's write sandbox blocks writing any `.env*` file outright; rename
it locally to `.env.local` as shown above.)

## Environment variables

| Variable | Scope | Notes |
|---|---|---|
| `NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN` | public | e.g. `your-store.myshopify.com` |
| `SHOPIFY_STOREFRONT_API_TOKEN` | server-only | Shopify Storefront API access token |

Until the Shopify store is provisioned, `lib/shopify/client.ts` fails safely:
`shopifyFetch` returns `{ ok: false, error }` instead of throwing, and never
logs the token value.

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
