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
cp env.example .env.local   # fill in Sanity/Stripe values, or set
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
| `COMMERCE_SOURCE` | server-only | Empty or unset means `sanity` (the live catalog). Only the exact value `fixtures` switches to the demo products (no credentials required; dev/test-only, e.g. `COMMERCE_SOURCE=fixtures`); any other value also means `sanity`. |
| `NEXT_PUBLIC_SANITY_PROJECT_ID` / `NEXT_PUBLIC_SANITY_DATASET` | public | Sanity project identifiers; fall back to the real project's values in `sanity/env.ts` when unset or empty. |
| `NEXT_PUBLIC_SITE_URL` | public | Used for `metadataBase`, canonical/hreflang URLs, and the sitemap/robots routes; falls back to `http://localhost:3000` when unset. |
| `STRIPE_SECRET_KEY` | server-only | Stripe key for Checkout Sessions (`sk_test_…` while testing, `sk_live_…` at launch); never prefix `NEXT_PUBLIC_`. The app fails safe (never throws, never logs the key) when unset. **It is also the payments switch:** while it is unset the cart offers "Apartar por mensaje" (a link to the contact form) instead of the checkout button, and the checkout Server Action refuses before reading Sanity. Set it and redeploy to turn payments on. |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | public | Stripe publishable key. |
| `STRIPE_WEBHOOK_SECRET` | server-only | Signing secret for the Stripe webhook (`app/api/stripe/webhook/route.ts`), which marks a paid piece sold and records the sale; it must listen to `checkout.session.completed` and `checkout.session.async_payment_succeeded`. Never prefix `NEXT_PUBLIC_`. Unset or invalid signatures fail closed (400, nothing processed). |
| `SANITY_WRITE_TOKEN` | server-only | Write-capable token used to mark a paid piece `sold` (the Stripe webhook and the manual sale); never prefix `NEXT_PUBLIC_`. Never thrown on, never logged. **Unset is a failure, not a quiet no-op:** a paid piece can't be marked, so the webhook answers `500` (Stripe retries and shows it in its Dashboard) and a manual sale warns, by piece name, that the store was not updated. |
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

### Calculadora, Inventario and Inversiones

Three more panel pages, all behind the same session check:

- **Calculadora** — casting math (metal from wax weight, fine and alloy split,
  with the alloy table prefilled and editable). "Registrar vaciado" consumes the
  chosen fine-metal and alloy materials.
- **Inventario** — materials with stock, average cost and per-material history.
- **Inversiones** — purchases by period (this month / last month / this year,
  in `America/Mexico_City` time) with the period total. To load what she already
  has, register it as a purchase called **Inventario inicial** with its cost.

Firestore collections (written only by the Admin SDK, inside transactions):
`materials` (current stock and average cost) with an append-only `movements`
subcollection, `purchases`, `castings` and `auditLog` (who did what to which
document, never the values). Money is stored as integer centavos. Every query
filters or orders by a single field, so **no composite index is needed** — there
is no `firestore.indexes.json` to deploy.

### Piezas and Ventas

Two more pages behind the same session check:

- **Piezas** — every product in Sanity (sold ones included) with its price, the
  cost to make it, the margin and the margin %. A piece with no cost recorded
  shows **Costo pendiente**. "Calcular metal" fills the metal cost from grams ×
  the average cost per gram of a chosen inventory material.
- **Ventas** — sales by period (same Mexico-time periods as Inversiones) with the
  totals: **Ventas** (the pieces' prices, shipping apart), **Costo de lo
  vendido** and **Utilidad bruta**. Online-shop sales appear on their own; **Registrar
  venta** adds one made outside the shop (price starts at the catalog's and can be
  lowered), optionally marking the piece sold in the store. **Anular venta** voids a
  manual sale: it stays on the list, muted, and leaves every total (nothing is
  deleted, and it does not put the piece back on sale — do that in Studio).

Collections: `pieces/{handle}` (cost by catalog slug; no document = cost pending)
and `sales/{id}`. A sale freezes the cost of its pieces when it is recorded, so a
later cost change never rewrites history; a sale that includes a piece with no cost
is flagged `costPending` and the period totals warn that the gross profit is an
upper bound. Sales hold **no customer data** (no email, name, address or phone):
that stays in Stripe, and the sale keeps only the Checkout Session id.

**Stripe webhook — pay before sell.** A piece is marked sold, and its sale
recorded, only once its payment is confirmed: on `checkout.session.completed` with
`payment_status: "paid"`, or on `checkout.session.async_payment_succeeded`. An
unpaid `completed` and `checkout.session.async_payment_failed` are answered `200`
and do nothing. Checkout is **card-only, enforced in code**
(`payment_method_types: ["card"]` in `lib/commerce/stripe/checkout.ts`), so the
Stripe Dashboard's payment-method settings can't introduce a delayed voucher; the
async events are handled anyway so enabling one later stays correct. Both events
must be selected on the Dashboard endpoint (see "Stripe go-live").

For a paid session the webhook marks the piece(s) sold, then records the sale as
`sales/stripe_<session id>`, written with `create`, so a redelivered event is a
harmless duplicate. Both steps are always attempted, and **any failure answers
`500` so Stripe retries and shows it in its Dashboard**, rather than losing a paid
sale or leaving a paid piece on sale: a piece that could not be marked sold (no
`SANITY_WRITE_TOKEN`, Sanity down), a sale that could not be written, or Firestore
not being configured at all (one fixed log line). A product that no longer exists
in Sanity is not a failure. Marking sold is idempotent and the sale is create-only,
so a retry is safe. Signature verification is unchanged and still runs first. An
online sale cannot be voided from the panel (refund it in Stripe).

### Resumen and Respaldo

The panel's home page, behind the same session check:

- **Resumen** — the KPIs of a period (this month / last month / this year, Mexico
  time): **Ventas**, **Costo de lo vendido**, **Utilidad bruta** (with its margin;
  red when negative), **Inversiones**, **Flujo** (ventas − inversiones), the value
  of the inventory, pieces available / sold, unread messages and the sales still
  waiting for a cost — plus a chart of the last 12 months (empty months included)
  with a "Ver como tabla" view of the same numbers. One read of the sales and
  purchases (the period plus those 12 months) feeds the cards and the chart, in
  cursor-paged batches of 500, newest first, single-field queries only (still no
  composite index). A read that reaches its cap is never hidden: the page shows
  **Datos parciales** and says which figures are affected.
- **Descargar respaldo** — `GET /admin/api/export` (admin only, `401` JSON
  otherwise) downloads every collection as one JSON file,
  `nerea-respaldo-YYYY-MM-DD.json` (Mexico date): materials with their
  `movements`, purchases, castings, pieces, sales, contact messages and the audit
  log. Timestamps are ISO strings, `Cache-Control: no-store`, nothing is logged.
  **It contains visitors' personal data** (the contact inbox): keep it somewhere
  safe. The charts use `recharts`, loaded only on this page.

## Testing and CI

```bash
npx tsc --noEmit
npm run lint
npm test
npm run build
```

Vitest is configured for targeted unit tests only (see `design.md`'s Testing
Strategy) — no broader test framework is set up beyond what each day's tasks
need. GitHub Actions ([`.github/workflows/ci.yml`](.github/workflows/ci.yml))
runs the four commands above, in that order, on Node 22, for every pull request
and every push to `main`. It needs no secrets: the build works with no
environment variables at all, because every integration (Stripe, Firebase, the
Sanity write token) fails safe when its key is missing.

## Legal pages (draft)

`/privacidad` (Aviso de privacidad), `/terminos` (Términos de compra) and
`/envios` (Envíos y devoluciones) exist in both languages, are linked from the
footer and are listed in the sitemap. The copy is a **draft** for a one-person
Mexican jewelry business. It lives in `messages/es.json` and `messages/en.json`
under `Legal`, as plain text (never HTML). The facts that are not known yet are
the bracketed values in `Legal.values` (`[NOMBRE DE LA RESPONSABLE]`,
`[DOMICILIO]`, `[CORREO DE CONTACTO]`, `[TELÉFONO DE CONTACTO]`,
`[PLAZO DE ENTREGA]`, …): replace each one, once per language. While any
bracketed placeholder remains, the page shows a "Borrador pendiente de revisión"
note, and the note disappears by itself after the last one is replaced. The
jeweler, ideally with a lawyer, should approve the wording before launch.

## Launch checklist (Netlify runbook)

The storefront runs on **Netlify** (Free plan: commercial use is allowed) and
the Studio on **Sanity hosting**, so the jeweler's day-to-day editing never uses
storefront credits. Do the steps in order; the ones marked *(jeweler)* are hers.

### 1. Create the Netlify site and set its environment

Netlify > Add new site > Import an existing project > this GitHub repo, branch
`main`. Netlify detects Next.js; there is no `netlify.toml`. Then Site
configuration > Environment variables:

| Variable | Value |
|---|---|
| `NODE_VERSION` | `22` |
| `NEXT_PUBLIC_SITE_URL` | The public URL, with protocol and no trailing slash (the `*.netlify.app` URL until a domain is connected). Canonical URLs, the sitemap and the Stripe redirects derive from it. |
| `SANITY_WRITE_TOKEN` | Editor token from sanity.io/manage > API > Tokens; the Stripe webhook uses it to mark a purchased piece sold. |
| `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` | Service account from the Firebase setup above (the key on one line, with literal `\n`). |
| `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Firebase web app config. |
| `ADMIN_EMAILS` | Comma-separated emails allowed into `/admin`. |
| `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` | Leave unset until step 6: the cart shows the payments gate meanwhile. |

Leave `COMMERCE_SOURCE` unset or empty (the live catalog is the default). A variable only
reaches a new build, so redeploy after changing any of them (`NEXT_PUBLIC_*`
values are inlined at build time). The contact form's rate limiter detects
Netlify at build time and reads `x-nf-client-connection-ip`; there is nothing to
configure. Every production deploy uses Netlify credits, so batch merges to
`main`.

### 2. Sanity CORS

sanity.io/manage > the project > API > CORS origins > add the Netlify URL (and
the custom domain later) with **Allow credentials**. It is only needed for the
embedded `/studio` on the live site; keep `http://localhost:3000` for local
development.

### 3. Firestore rules

Firebase console > Firestore Database > Rules: paste
[`firestore.rules`](firestore.rules) and publish (step 4 of the Firebase setup
above, if not done yet).

### 4. Deploy Studio to Sanity hosting (you run these)

```bash
npx sanity login     # once per machine; opens the browser
npx sanity deploy    # builds the Studio and publishes it
```

The hostname comes from `studioHost` in [`sanity.cli.ts`](sanity.cli.ts), so the
Studio is published at https://nerea.sanity.studio (if the name is taken the CLI
asks for another one: update `studioHost` to match). Add the jeweler under
sanity.io/manage > Members. The hosted Studio needs **no CORS entry**, and the
embedded `/studio` route keeps working locally (`npm run dev`, then
http://localhost:3000/studio). Re-run `npx sanity deploy` after a schema change;
content edits never need it. The first deploy prints an app ID, which can be
pinned as `deployment.appId` in `sanity.cli.ts`.

### 5. Content *(jeweler)*

- In Studio, per piece: **Opción de compra** (ninguna, talla de anillo or largo
  de cadena). In **Ajustes del sitio**: **Costo de envío** (in centavos:
  `15000` is $150.00 MXN, `0` is free shipping).
- Legal pages: fill in the bracketed placeholders and approve the wording (see
  "Legal pages (draft)" above). They live in the `messages` files, not in Studio.

### 6. Stripe go-live

1. Finish activating the Stripe account (business details, bank account).
2. Netlify: set `STRIPE_SECRET_KEY` and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`.
3. Stripe Dashboard > Developers > Webhooks > Add endpoint:
   `https://<your-site>/api/stripe/webhook`, events **`checkout.session.completed`
   and `checkout.session.async_payment_succeeded`** (select both: a piece is
   only sold once its payment is confirmed). Copy its signing secret into
   `STRIPE_WEBHOOK_SECRET`. Test and live mode have separate keys and separate
   endpoints: create the endpoint in the same mode as the keys.
4. **Redeploy.** The payments gate lifts when the build sees
   `STRIPE_SECRET_KEY`.
5. Test purchase: first with test keys (card `4242 4242 4242 4242`). Stripe asks
   for the shipping address and phone, the success page shows, and the webhook
   flips the piece to **Vendida** in Studio. Then switch to the live keys and
   webhook secret, redeploy, buy one real piece and refund it from the Dashboard.

## Dependency notes

Next.js is pinned exactly (`next` and `eslint-config-next` share a version).
`package.json` carries one `overrides` entry, `@grpc/grpc-js` `^1.13.6`:
`firebase` pulls `@firebase/firestore`, which pins a vulnerable 1.9.x, and the
storefront only ever loads `firebase/auth` in the browser, so the override just
keeps that unused copy off the advisory list. What `npm audit --omit=dev` still
reports lives inside Sanity's own CLI and build tooling (`adm-zip`, `js-yaml`,
`smol-toml` and `undici`, all behind `sanity`): the only fix npm offers is a
downgrade to `sanity@5.14.1`, so those wait for upstream releases. Run
`npm audit --omit=dev` again before launch.
