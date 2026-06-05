import type { NextConfig } from "next";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const pkg = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "package.json"), "utf-8")
) as { version: string };

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
  },
  // Serve the idiomatic RFC 8615 machine-discovery entrypoint by rewriting it
  // to the always-available /api/discovery route. A `.well-known` route folder
  // under `app/` is excluded by the TS project glob and not reliably served, so
  // a rewrite is the robust way to expose the stable well-known URL.
  async rewrites() {
    return [
      { source: "/.well-known/foolery.json", destination: "/api/discovery" },
    ];
  },
};

export default nextConfig;
