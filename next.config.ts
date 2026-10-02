import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  // Which hosting platform produced this build, inlined into the bundles at
  // BUILD time. It has to be resolved here: Netlify's `NETLIFY` variable exists
  // only while the build runs, not in the function runtime, so reading it at
  // request time (lib/contact/submit.ts) would always see it unset. The contact
  // form's rate limiter uses it to pick the one client-IP header that platform
  // sets and callers cannot forge. "" = unknown host: a shared, fail-closed
  // bucket.
  env: {
    DEPLOY_PLATFORM: process.env.NETLIFY
      ? "netlify"
      : process.env.VERCEL
        ? "vercel"
        : "",
  },
  images: {
    // Real product images are served from Sanity's CDN once the catalog is
    // populated. Fixtures fall back to a local placeholder (PlaceholderBlock)
    // when an image is missing, so no remote pattern is needed for them.
    remotePatterns: [
      {
        protocol: "https",
        hostname: "cdn.sanity.io",
      },
    ],
  },
  experimental: {
    // Defense in depth: the contact form's largest legitimate payload is ~2 KB
    // (name 80 + email 160 + message 2000 chars). Cap Server Action bodies far
    // below Next's implicit 1 MB default so an oversized POST is rejected early.
    serverActions: {
      bodySizeLimit: "64kb",
    },
  },
};

export default withNextIntl(nextConfig);
