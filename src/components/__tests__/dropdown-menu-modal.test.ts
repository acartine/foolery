import { describe, expect, it } from "vitest";

describe("DropdownMenu", () => {
  it("defaults modal to false to avoid scroll-lock jitter", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(
      path.resolve(__dirname, "../ui/dropdown-menu.tsx"),
      "utf-8",
    );

    expect(source).toContain("modal = false");
    expect(source).toContain("modal={modal}");
  });
});
