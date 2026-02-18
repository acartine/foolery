import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";

describe("cn utility", () => {
  it("merges class names", () => {
    const result = cn("px-2", "py-1");
    expect(result).toBe("px-2 py-1");
  });

  it("handles conditional classes", () => {
    const result = cn("base", false && "hidden", "visible");
    expect(result).toBe("base visible");
  });

  it("merges tailwind conflicts correctly", () => {
    const result = cn("px-2 py-1", "px-4");
    expect(result).toBe("py-1 px-4");
  });

  it("handles undefined and null inputs", () => {
    const result = cn("base", undefined, null, "end");
    expect(result).toBe("base end");
  });

  it("returns empty string for no args", () => {
    const result = cn();
    expect(result).toBe("");
  });
});
