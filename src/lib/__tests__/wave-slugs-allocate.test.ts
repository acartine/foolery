import { describe, expect, it } from "vitest";
import { allocateWaveSlug } from "@/lib/wave-slugs";

describe("allocateWaveSlug fallback paths", () => {
  it("returns preferred slug when available", () => {
    const used = new Set<string>();
    const slug = allocateWaveSlug(used, "My Cool Slug");
    expect(slug).toBe("my-cool-slug");
    expect(used.has("my-cool-slug")).toBe(true);
  });

  it("falls back to composed candidate when preferred is taken", () => {
    const used = new Set(["taken-slug"]);
    const slug = allocateWaveSlug(used, "Taken Slug");
    expect(slug).not.toBe("taken-slug");
    expect(slug.length).toBeGreaterThan(0);
    expect(used.has(slug)).toBe(true);
  });

  it("falls back to generated slug when no preferred slug given", () => {
    const used = new Set<string>();
    const slug = allocateWaveSlug(used);
    expect(slug.length).toBeGreaterThan(0);
    expect(used.has(slug)).toBe(true);
  });

  it("generates multiple unique slugs from the same used set", () => {
    const used = new Set<string>();
    const slugs: string[] = [];
    for (let i = 0; i < 10; i++) {
      slugs.push(allocateWaveSlug(used));
    }
    // All slugs should be unique since they're added to `used`
    expect(new Set(slugs).size).toBe(10);
  });

  it("handles collision by trying multiple composed candidates", () => {
    // Pre-fill with a large set of slugs to force multiple attempts
    const used = new Set<string>();
    // Generate first one to know what it would produce
    const firstSlug = allocateWaveSlug(new Set<string>());
    used.add(firstSlug);

    // Now allocate again - should get a different one since first is taken
    const secondSlug = allocateWaveSlug(used);
    expect(secondSlug).not.toBe(firstSlug);
    expect(used.has(secondSlug)).toBe(true);
  });

  it("handles empty preferred slug by generating", () => {
    const used = new Set<string>();
    const slug = allocateWaveSlug(used, "");
    expect(slug.length).toBeGreaterThan(0);
  });

  it("handles whitespace-only preferred slug by generating", () => {
    const used = new Set<string>();
    const slug = allocateWaveSlug(used, "   ");
    // normalizeWaveSlugCandidate("   ") returns "", which is falsy
    expect(slug.length).toBeGreaterThan(0);
  });
});
