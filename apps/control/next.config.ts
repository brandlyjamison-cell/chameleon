import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: [
    "@chameleon/contracts",
    "@chameleon/db",
    "@chameleon/engine",
    "@chameleon/skeleton",
  ],
  serverExternalPackages: ["pg", "better-auth", "kysely"],
  experimental: { serverActions: { bodySizeLimit: "2mb" } },
};

export default config;
