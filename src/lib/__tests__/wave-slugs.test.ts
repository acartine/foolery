import { describe, expect, it } from "vitest";
import {
  allocateWaveSlug,
  buildWaveSlugLabel,
  buildWaveTitle,
  extractWaveSlug,
  isLegacyNumericWaveSlug,
  normalizeWaveSlugCandidate,
  rewriteWaveTitleSlug,
} from "@/lib/wave-slugs";

describe("wave-slugs", () => {
  it("normalizes slug candidates to lowercase kebab-case", () => {
    expect(normalizeWaveSlugCandidate("  Streep Montage  ")).toBe("streep-montage");
    expect(normalizeWaveSlugCandidate("Heat___Take__2")).toBe("heat-take-2");
  });

  it("extracts slug from orchestration labels", () => {
    const labels = ["foo:bar", "orchestration:wave", "orchestration:wave:pacino-dolly"];
    expect(extractWaveSlug(labels)).toBe("pacino-dolly");
  });

  it("detects legacy numeric slugs", () => {
    expect(isLegacyNumericWaveSlug("1")).toBe(true);
    expect(isLegacyNumericWaveSlug("022")).toBe(true);
    expect(isLegacyNumericWaveSlug("heat-1")).toBe(false);
    expect(isLegacyNumericWaveSlug(null)).toBe(false);
  });

  it("allocates unique slugs and respects preferred slug when available", () => {
    const used = new Set<string>(["streep-montage"]);
    const preferred = allocateWaveSlug(used, "Pacino Dolly");
    expect(preferred).toBe("pacino-dolly");
    expect(used.has("pacino-dolly")).toBe(true);

    const generatedOne = allocateWaveSlug(used);
    const generatedTwo = allocateWaveSlug(used);
    expect(generatedOne).not.toBe(generatedTwo);
    expect(used.has(generatedOne)).toBe(true);
    expect(used.has(generatedTwo)).toBe(true);
  });

  it("builds labels and titles for waves", () => {
    expect(buildWaveSlugLabel("streep-montage")).toBe(
      "orchestration:wave:streep-montage"
    );
    expect(buildWaveTitle("streep-montage", "Backend unblockers")).toBe(
      "Scene streep-montage: Backend unblockers"
    );
    expect(rewriteWaveTitleSlug("Wave 1: Backend unblockers", "streep-montage")).toBe(
      "Scene streep-montage: Backend unblockers"
    );
  });
});
