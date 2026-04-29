import { describe, expect, it } from "vitest";
import {
  createLineNormalizer,
} from "@/lib/agent-adapter";

describe("createLineNormalizer - claude dialect", () => {
  const normalize = createLineNormalizer("claude");

  it("passes through valid objects", () => {
    const input = { type: "assistant", message: { content: [] } };
    expect(normalize(input)).toEqual(input);
  });

  it("returns null for non-objects", () => {
    expect(normalize(null)).toBeNull();
    expect(normalize("string")).toBeNull();
    expect(normalize(42)).toBeNull();
  });
});
