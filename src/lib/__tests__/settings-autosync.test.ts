import { describe, expect, it } from "vitest";
import {
  DEFAULT_INTERACTIVE_SESSION_TIMEOUT_MINUTES,
} from "@/lib/interactive-session-timeout";
import { DEFAULT_SCOPE_REFINEMENT_PROMPT } from "@/lib/scope-refinement-defaults";
import { foolerySettingsSchema } from "@/lib/schemas";
import { mergeSettingsPartial } from "@/lib/settings-update";

const baseSettings = foolerySettingsSchema.parse({
  agents: {},
  actions: {
    take: "",
    scene: "",
    scopeRefinement: "",
    staleGrooming: "",
  },
  backend: { type: "auto" },
  defaults: {
    profileId: "",
    interactiveSessionTimeoutMinutes:
      DEFAULT_INTERACTIVE_SESSION_TIMEOUT_MINUTES,
  },
  scopeRefinement: { prompt: DEFAULT_SCOPE_REFINEMENT_PROMPT },
  pools: {
    orchestration: [],
    planning: [],
    plan_review: [],
    implementation: [],
    implementation_review: [],
    shipment: [],
    shipment_review: [],
    scope_refinement: [],
    stale_grooming: [],
  },
  dispatchMode: "basic",
  maxConcurrentSessions: 7,
  maxClaimsPerQueueType: 10,
  terminalLightTheme: false,
});

describe("autoSync setting", () => {
  it("defaults to false when absent", () => {
    expect(baseSettings.autoSync).toBe(false);
  });

  it("preserves true when provided", () => {
    const settings = foolerySettingsSchema.parse({
      ...baseSettings,
      autoSync: true,
    });

    expect(settings.autoSync).toBe(true);
  });

  it("merges auto sync without clobbering other settings", () => {
    const updated = mergeSettingsPartial(baseSettings, {
      autoSync: true,
    });

    expect(updated.autoSync).toBe(true);
    expect(updated.maxConcurrentSessions).toBe(7);
    expect(updated.actions.take).toBe("");
  });
});
