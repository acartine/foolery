import { describe, expect, it } from "vitest";
import {
  normalizeWaveSlugCandidate,
  isWaveLabel,
  isInternalLabel,
  isReadOnlyLabel,
  isWaveSlugLabel,
  getWaveSlugLabels,
  extractWaveSlug,
  isLegacyNumericWaveSlug,
  buildWaveSlugLabel,
  allocateWaveSlug,
  buildWaveTitle,
  rewriteWaveTitleSlug,
  ORCHESTRATION_WAVE_LABEL,
  ORCHESTRATION_WAVE_LABEL_PREFIX,
} from "@/lib/wave-slugs";

describe("normalizeWaveSlugCandidate edge cases", () => {
  it("strips leading/trailing hyphens", () => {
    expect(normalizeWaveSlugCandidate("--foo--")).toBe("foo");
  });

  it("returns empty string for empty input", () => {
    expect(normalizeWaveSlugCandidate("")).toBe("");
  });

  it("collapses multiple special chars to single hyphen", () => {
    expect(normalizeWaveSlugCandidate("a!!!b")).toBe("a-b");
  });

  it("handles purely numeric input", () => {
    expect(normalizeWaveSlugCandidate("123")).toBe("123");
  });
});

describe("isWaveLabel", () => {
  it("returns true for exact wave label", () => {
    expect(isWaveLabel(ORCHESTRATION_WAVE_LABEL)).toBe(true);
  });

  it("returns true for wave slug label", () => {
    expect(isWaveLabel(`${ORCHESTRATION_WAVE_LABEL_PREFIX}my-slug`)).toBe(true);
  });

  it("returns false for unrelated label", () => {
    expect(isWaveLabel("stage:verification")).toBe(false);
  });
});

describe("isInternalLabel", () => {
  it("returns true for wave labels", () => {
    expect(isInternalLabel(ORCHESTRATION_WAVE_LABEL)).toBe(true);
  });

  it("returns true for stage labels", () => {
    expect(isInternalLabel("stage:verification")).toBe(true);
    expect(isInternalLabel("stage:retry")).toBe(true);
  });

  it("returns false for user labels", () => {
    expect(isInternalLabel("frontend")).toBe(false);
  });
});

describe("isReadOnlyLabel", () => {
  it("returns true for attempts labels", () => {
    expect(isReadOnlyLabel("attempts:1")).toBe(true);
    expect(isReadOnlyLabel("attempts:99")).toBe(true);
  });

  it("returns false for other labels", () => {
    expect(isReadOnlyLabel("stage:retry")).toBe(false);
    expect(isReadOnlyLabel("frontend")).toBe(false);
  });
});

describe("isWaveSlugLabel", () => {
  it("returns true for slug labels", () => {
    expect(isWaveSlugLabel(`${ORCHESTRATION_WAVE_LABEL_PREFIX}slug`)).toBe(
      true
    );
  });

  it("returns false for bare wave label", () => {
    expect(isWaveSlugLabel(ORCHESTRATION_WAVE_LABEL)).toBe(false);
  });
});

describe("getWaveSlugLabels", () => {
  it("filters only wave slug labels", () => {
    const labels = [
      "foo",
      `${ORCHESTRATION_WAVE_LABEL_PREFIX}a`,
      ORCHESTRATION_WAVE_LABEL,
      `${ORCHESTRATION_WAVE_LABEL_PREFIX}b`,
    ];
    const result = getWaveSlugLabels(labels);
    expect(result).toHaveLength(2);
    expect(result[0]).toContain("a");
    expect(result[1]).toContain("b");
  });

  it("returns empty array when no wave slug labels", () => {
    expect(getWaveSlugLabels(["foo", "bar"])).toEqual([]);
  });
});

describe("extractWaveSlug edge cases", () => {
  it("returns null for empty labels", () => {
    expect(extractWaveSlug([])).toBeNull();
  });

  it("returns null when wave slug label has empty slug", () => {
    expect(extractWaveSlug([`${ORCHESTRATION_WAVE_LABEL_PREFIX}`])).toBeNull();
  });

  it("returns null when wave slug label has only whitespace slug", () => {
    expect(
      extractWaveSlug([`${ORCHESTRATION_WAVE_LABEL_PREFIX}   `])
    ).toBeNull();
  });

  it("returns first valid slug when multiple exist", () => {
    const labels = [
      `${ORCHESTRATION_WAVE_LABEL_PREFIX}first`,
      `${ORCHESTRATION_WAVE_LABEL_PREFIX}second`,
    ];
    expect(extractWaveSlug(labels)).toBe("first");
  });
});

describe("isLegacyNumericWaveSlug edge cases", () => {
  it("returns false for undefined", () => {
    expect(isLegacyNumericWaveSlug(undefined)).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isLegacyNumericWaveSlug("")).toBe(false);
  });

  it("returns true for single digit", () => {
    expect(isLegacyNumericWaveSlug("0")).toBe(true);
  });
});

describe("buildWaveSlugLabel", () => {
  it("normalizes the slug before building label", () => {
    expect(buildWaveSlugLabel("My Slug")).toBe(
      `${ORCHESTRATION_WAVE_LABEL_PREFIX}my-slug`
    );
  });
});

describe("allocateWaveSlug extended", () => {
  it("does not return an already-used preferred slug", () => {
    const used = new Set(["my-slug"]);
    const result = allocateWaveSlug(used, "My Slug");
    // preferred is "my-slug" which is taken, so it should generate a new one
    expect(result).not.toBe("my-slug");
    expect(used.has(result)).toBe(true);
  });

  it("generates unique slugs when no preferred slug", () => {
    const used = new Set<string>();
    const slugs: string[] = [];
    for (let i = 0; i < 10; i++) {
      slugs.push(allocateWaveSlug(used));
    }
    // All slugs should be unique
    expect(new Set(slugs).size).toBe(10);
  });
});

describe("buildWaveTitle", () => {
  it("returns Scene slug when name is empty", () => {
    expect(buildWaveTitle("my-slug", "")).toBe("Scene my-slug");
  });

  it("returns Scene slug when name is whitespace", () => {
    expect(buildWaveTitle("my-slug", "   ")).toBe("Scene my-slug");
  });

  it("trims whitespace from name", () => {
    expect(buildWaveTitle("s", "  Hello  ")).toBe("Scene s: Hello");
  });
});

describe("rewriteWaveTitleSlug extended", () => {
  it("returns Scene slug for empty title", () => {
    expect(rewriteWaveTitleSlug("", "new")).toBe("Scene new");
  });

  it("returns Scene slug for whitespace title", () => {
    expect(rewriteWaveTitleSlug("  ", "new")).toBe("Scene new");
  });

  it("rewrites Scene prefix to new slug", () => {
    expect(rewriteWaveTitleSlug("Scene old: Backend", "new")).toBe(
      "Scene new: Backend"
    );
  });

  it("rewrites Wave prefix to Scene with new slug", () => {
    expect(rewriteWaveTitleSlug("Wave 1: API work", "slug")).toBe(
      "Scene slug: API work"
    );
  });

  it("prepends Scene slug when no wave/scene prefix", () => {
    expect(rewriteWaveTitleSlug("Just a title", "slug")).toBe(
      "Scene slug: Just a title"
    );
  });

  it("handles case insensitive wave prefix", () => {
    expect(rewriteWaveTitleSlug("WAVE 1: test", "s")).toBe("Scene s: test");
  });

  it("handles case insensitive scene prefix", () => {
    expect(rewriteWaveTitleSlug("SCENE old: test", "s")).toBe(
      "Scene s: test"
    );
  });
});
