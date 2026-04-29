import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  // Workspace TS packages must be transpiled by Next; they ship raw .ts.
  transpilePackages: [
    "@pokemon-ranker/shared",
    "@pokemon-ranker/filter",
    "@pokemon-ranker/ranker",
  ],
  // better-sqlite3 is a Node native binding; keep it external from the
  // server bundle so Next doesn't try to walk its internals.
  serverExternalPackages: ["better-sqlite3"],
  // Bundle the Pokédex SQLite with the /pick serverless function on Vercel.
  // Without this Vercel's file-tracing wouldn't see the runtime read and
  // the function would 404 the DB. Per D-22's single-deploy decision.
  outputFileTracingIncludes: {
    "/pick": ["./data/pokedex.sqlite"],
  },
  images: {
    // Sprite/cry hot-link domains until D-21's R2 mirror lands.
    remotePatterns: [
      { protocol: "https", hostname: "raw.githubusercontent.com" },
    ],
  },
};

export default config;
