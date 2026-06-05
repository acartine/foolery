import { describe, expect, it } from "vitest";

import nextConfig from "../../../next.config";

describe("next config", () => {
  it("allows local dev origins that Next.js warns about by default", () => {
    expect(nextConfig.allowedDevOrigins).toEqual([
      "127.0.0.1",
      "localhost",
    ]);
  });

  it("rewrites the well-known discovery path to /api/discovery", async () => {
    const rewrites = await nextConfig.rewrites?.();
    const list = Array.isArray(rewrites) ? rewrites : rewrites?.beforeFiles ?? [];
    expect(list).toContainEqual({
      source: "/.well-known/foolery.json",
      destination: "/api/discovery",
    });
  });
});
