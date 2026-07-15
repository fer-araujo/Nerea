import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

// Next.js compiles this pattern into the routing layer that decides whether
// middleware runs at all — it excludes API routes, Next's internal assets
// (_next, _vercel), the embedded Sanity Studio (/studio — intentionally not
// locale-routed, see app/studio/), and any path containing a file extension
// (e.g. /favicon.ico). This exclusion happens BEFORE middleware() is
// invoked, so it cannot be verified by calling middleware() directly in a
// test; see tests/middleware-matcher.test.ts, which checks this pattern in
// isolation.
export const MIDDLEWARE_MATCHER = "/((?!api|_next|_vercel|studio|.*\\..*).*)";

export default createMiddleware(routing);

// NOTE: Next.js statically parses `config.matcher` at build time and
// requires literal strings here — it cannot resolve an imported/exported
// identifier, even though `MIDDLEWARE_MATCHER` above holds the exact same
// literal. Keep this string in sync with `MIDDLEWARE_MATCHER`.
export const config = {
  matcher: ["/((?!api|_next|_vercel|studio|.*\\..*).*)"],
};
