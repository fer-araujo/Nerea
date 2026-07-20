import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
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
