import { describe, expect, it } from "vitest";

import {
  buildAgentDiagnostic,
} from "@/lib/scope-refinement-worker-state";

describe("buildAgentDiagnostic", () => {
  it("uses resolved agent id, model, and version without hard-coding", () => {
    expect(
      buildAgentDiagnostic(
        {
          kind: "cli",
          command: "claude",
          label: "Claude Sonnet",
          model: "sonnet",
          version: "4.7",
        },
        "claude-sonnet",
      ),
    ).toEqual({
      agentName: "claude-sonnet",
      agentModel: "sonnet",
      agentVersion: "4.7",
    });
  });

  it("falls back to command and marks missing model details unknown", () => {
    expect(
      buildAgentDiagnostic({
        kind: "cli",
        command: "codex",
      }, undefined),
    ).toEqual({
      agentName: "codex",
      agentModel: "unknown",
      agentVersion: "unknown",
    });
  });
});
