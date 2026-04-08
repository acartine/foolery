import { describe, expect, it } from "vitest";
import {
  shouldContinueShipFollowUp,
} from "@/lib/terminal-manager-follow-up";

describe("shouldContinueShipFollowUp", () => {
  it("continues on clean close even without a result event", () => {
    expect(
      shouldContinueShipFollowUp({
        exitCode: 0,
        exitReason: "raw_close",
        executionPromptSent: true,
        shipCompletionPromptSent: false,
        autoShipCompletionPrompt: "follow up",
      }),
    ).toBe(true);
  });

  it("suppresses follow-up for fatal runtime exits", () => {
    expect(
      shouldContinueShipFollowUp({
        exitCode: 0,
        exitReason: "timeout",
        executionPromptSent: true,
        shipCompletionPromptSent: false,
        autoShipCompletionPrompt: "follow up",
      }),
    ).toBe(false);
  });
});
