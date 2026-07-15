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
};

export default withNextIntl(nextConfig);
