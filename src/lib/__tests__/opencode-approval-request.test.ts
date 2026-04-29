import { describe, expect, it } from "vitest";
import {
  extractOpenCodePermissionAsked,
} from "@/lib/opencode-approval-request";

const RM_PATH =
  "rm /Users/cartine/knots/src/db/tests_pagination.rs";

describe("OpenCode bash rm permission with empty metadata", () => {
  it("derives a meaningful command summary from patterns", () => {
    const request = extractOpenCodePermissionAsked({
      type: "permission.asked",
      properties: {
        id: "per_dd956e814001",
        sessionID: "ses_dd956e8140019cf3",
        type: "bash",
        toolName: "bash",
        permission: "bash",
        patterns: [RM_PATH],
        metadata: {},
        tool: {
          callID: "functions.bash:39",
        },
      },
    });

    expect(request).not.toBeNull();
    expect(request?.adapter).toBe("opencode");
    expect(request?.toolName).toBe("bash");
    expect(request?.toolUseId).toBe("functions.bash:39");
    expect(request?.patterns).toEqual([RM_PATH]);
    const summary =
      request?.parameterSummary ?? request?.toolParamsDisplay;
    expect(summary).toBe(RM_PATH);
    expect(summary).not.toBe("{}");
    expect(request?.parameterSummary).not.toContain("{}");
  });

  it("prefers metadata.command over patterns when present", () => {
    const request = extractOpenCodePermissionAsked({
      type: "permission.asked",
      id: "per_x1",
      sessionID: "ses_x1",
      permission: "bash",
      patterns: ["Bash(git:*)"],
      metadata: { command: "git status --short" },
      tool: { callID: "call_x1" },
    });

    expect(request?.parameterSummary).toBe(
      "git status --short",
    );
  });

  it("treats empty metadata array as absent", () => {
    const request = extractOpenCodePermissionAsked({
      type: "permission.asked",
      id: "per_y",
      sessionID: "ses_y",
      permission: "bash",
      patterns: ["Bash(git:*)"],
      metadata: [],
      tool: { callID: "call_y" },
    });

    expect(request?.parameterSummary).toBe("Bash(git:*)");
    expect(request?.parameterSummary).not.toBe("[]");
  });

  it("falls back to arguments object when no command is present", () => {
    const request = extractOpenCodePermissionAsked({
      type: "permission.asked",
      id: "per_z",
      sessionID: "ses_z",
      permission: "bash",
      arguments: { cmd: "ls -la" },
      patterns: [],
      metadata: {},
      tool: { callID: "call_z" },
    });

    expect(request?.parameterSummary).toContain("ls -la");
  });
});
