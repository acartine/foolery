import { describe, expect, it } from "vitest";

import nextConfig from "../../../next.config";

describe("next config", () => {
  it("allows local dev origins that Next.js warns about by default", () => {
    expect(nextConfig.allowedDevOrigins).toEqual([
      "127.0.0.1",
      "localhost",
    ]);
  });
});
