import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@sts2/shared"],
  experimental: {
    // Tier list admin uploads full-page screenshots which can exceed the
    // default 10MB request body limit. Our extract route enforces a stricter
    // per-file MIME + size check on top of this.
    proxyClientMaxBodySize: 26_214_400, // 25 MB
  },
};

export default nextConfig;
