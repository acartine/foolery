import { describe, expect, it } from "vitest";
import {
  DEFAULT_SCOPE_REFINEMENT_PROMPT,
  interpolateScopeRefinementPrompt,
} from "@/lib/scope-refinement-defaults";

describe("interpolateScopeRefinementPrompt", () => {
  it("replaces template placeholders with beat content", () => {
    const result = interpolateScopeRefinementPrompt(DEFAULT_SCOPE_REFINEMENT_PROMPT, {
      title: "Original title",
      description: "Original description",
      acceptance: "Original acceptance",
    });

    expect(result).toContain("Title: Original title");
    expect(result).toContain("Original description");
    expect(result).toContain("Original acceptance");
  });

  it("fills missing values with an explicit placeholder", () => {
    const result = interpolateScopeRefinementPrompt(
      "D={{description}} A={{acceptance}}",
      { title: "Only title" },
    );

    expect(result).toBe("D=(none provided) A=(none provided)");
  });
});
