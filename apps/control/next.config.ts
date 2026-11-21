import type { NextConfig } from "next";

/** Everything behind the login stays out of search; the landing page may be indexed. */
const PRIVATE = [
  "/api/:path*",
  "/services/:path*",
  "/services",
  "/welcome",
  "/login",
  "/signup",
  "/account/:path*",
];

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
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // HSTS, nosniff and referrer-policy are set by Caddy, once.
          { key: "x-frame-options", value: "DENY" },
          {
            key: "permissions-policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
      ...PRIVATE.map((source) => ({
        source,
        headers: [{ key: "x-robots-tag", value: "noindex" }],
      })),
    ];
  },
};

export default config;
