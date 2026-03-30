import {
  describe, expect, it,
} from "vitest";
import { filterSearchableOption } from "@/components/settings-agents-scanned";

describe("filterSearchableOption", () => {
  it("matches case-insensitive substrings in the item value", () => {
    expect(
      filterSearchableOption(
        "glm-4-flash",
        "GLM",
      ),
    ).toBe(1);
  });

  it("matches case-insensitive substrings in keywords", () => {
    expect(
      filterSearchableOption(
        "provider/model",
        "miniMAX",
        ["OpenAI", "MiniMax"],
      ),
    ).toBe(1);
  });

  it("returns no match for unrelated searches", () => {
    expect(
      filterSearchableOption(
        "gpt-4.1",
        "claude",
        ["OpenAI", "GPT-4.1"],
      ),
    ).toBe(0);
  });

  it("keeps all options visible when the search is cleared", () => {
    expect(
      filterSearchableOption(
        "gemini-2.5-pro",
        "   ",
        ["Google", "Gemini"],
      ),
    ).toBe(1);
  });
});
