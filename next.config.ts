import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* Allow test scripts to isolate their build from the prod server */
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
};

export default nextConfig;
