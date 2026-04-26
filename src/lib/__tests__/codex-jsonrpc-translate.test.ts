import { describe, it, expect } from "vitest";
import {
  isTranslatedMethod,
  translateAgentMessageDelta,
  translateItemNotification,
  translateOutputDelta,
  translateReasoningDelta,
  translateTerminalInteraction,
  translateTurnCompleted,
} from "@/lib/codex-jsonrpc-translate";

describe("codex-translate: agentMessage delta", () => {
  it("reads params.delta (live wire format)", () => {
    const result = translateAgentMessageDelta({
      threadId: "t-1",
      turnId: "tu-1",
      itemId: "msg-1",
      delta: "Hello world",
    });
    expect(result).toEqual({
      type: "item.delta",
      item: { type: "agent_message", id: "msg-1" },
      text: "Hello world",
    });
  });

  it("falls back to params.text", () => {
    const result = translateAgentMessageDelta({
      itemId: "msg-1",
      text: "fallback shape",
    });
    expect(result?.text).toBe("fallback shape");
  });

  it("returns null when no text/delta", () => {
    expect(translateAgentMessageDelta({})).toBeNull();
    expect(
      translateAgentMessageDelta({ delta: "" }),
    ).toBeNull();
  });

  it("omits id when itemId missing", () => {
    const result = translateAgentMessageDelta({
      delta: "x",
    });
    expect(
      (result?.item as Record<string, unknown>).id,
    ).toBeUndefined();
  });
});

describe("codex-translate: outputDelta", () => {
  it("translates command output delta", () => {
    const result = translateOutputDelta({
      itemId: "call-1",
      delta: "stdout chunk\n",
    });
    expect(result).toEqual({
      type: "item.delta",
      item: {
        type: "command_execution",
        id: "call-1",
      },
      text: "stdout chunk\n",
    });
  });

  it("returns null for empty delta", () => {
    expect(translateOutputDelta({})).toBeNull();
    expect(
      translateOutputDelta({ delta: "" }),
    ).toBeNull();
  });
});

describe("codex-translate: reasoning delta", () => {
  it("emits item.delta with delta field", () => {
    const result = translateReasoningDelta({
      itemId: "rs-1",
      delta: "thinking...",
    });
    expect(result).toEqual({
      type: "item.delta",
      item: { type: "reasoning", id: "rs-1" },
      text: "thinking...",
    });
  });

  it("returns null when empty", () => {
    expect(translateReasoningDelta({})).toBeNull();
  });
});

describe("codex-translate: terminalInteraction", () => {
  it("translates with stdin", () => {
    const result = translateTerminalInteraction({
      itemId: "call-1",
      processId: "12345",
      stdin: "y\n",
    });
    expect(result).toEqual({
      type: "command_execution.terminal_interaction",
      item: {
        type: "command_execution", id: "call-1",
      },
      processId: "12345",
      stdin: "y\n",
    });
  });

  it("translates with empty stdin", () => {
    const result = translateTerminalInteraction({
      itemId: "call-1",
      processId: "12345",
      stdin: "",
    });
    expect(result?.stdin).toBe("");
    expect(
      (result?.item as Record<string, unknown>).id,
    ).toBe("call-1");
  });

  it("returns null when nothing useful", () => {
    expect(
      translateTerminalInteraction({}),
    ).toBeNull();
  });
});

describe("codex-translate: item filtering", () => {
  it("filters userMessage items (prompt echoes)", () => {
    expect(
      translateItemNotification("item/started", {
        item: {
          type: "userMessage",
          id: "u-1",
          content: [{ type: "text", text: "x" }],
        },
      }),
    ).toBeNull();
    expect(
      translateItemNotification("item/completed", {
        item: { type: "userMessage", id: "u-1" },
      }),
    ).toBeNull();
  });

  it("drops empty reasoning items (no summary)", () => {
    expect(
      translateItemNotification("item/completed", {
        item: {
          type: "reasoning",
          id: "rs-1",
          summary: [],
          content: [],
        },
      }),
    ).toBeNull();
  });
});

describe("codex-translate: reasoning items", () => {
  it("translates reasoning with summary array", () => {
    const result = translateItemNotification(
      "item/completed",
      {
        item: {
          type: "reasoning",
          id: "rs-1",
          summary: [
            { type: "summary_text", text: "step 1" },
            { type: "summary_text", text: "step 2" },
          ],
        },
      },
    );
    expect(result).toEqual({
      type: "item.completed",
      item: {
        type: "reasoning",
        text: "step 1\nstep 2",
      },
    });
  });

  it(
    "translates reasoning summaryParts (legacy)",
    () => {
      const result = translateItemNotification(
        "item/completed",
        {
          item: {
            type: "reasoning",
            id: "rs-1",
            summaryParts: [
              { type: "text", text: "legacy" },
            ],
          },
        },
      );
      expect(
        (result?.item as Record<string, unknown>).text,
      ).toBe("legacy");
    },
  );
});

describe("codex-translate: agentMessage items", () => {
  it("emits item.started for agentMessage", () => {
    const result = translateItemNotification(
      "item/started",
      {
        item: {
          type: "agentMessage",
          id: "msg-1",
          text: "",
          phase: "commentary",
        },
      },
    );
    expect(result).toEqual({
      type: "item.started",
      item: { type: "agent_message", id: "msg-1" },
    });
  });
});

describe("codex-translate: command items", () => {
  it(
    "translates commandExecution with aggregatedOutput",
    () => {
      const result = translateItemNotification(
        "item/completed",
        {
          item: {
            type: "commandExecution",
            id: "call-1",
            command: "echo hi",
            aggregatedOutput: "hi\n",
            status: "completed",
          },
        },
      );
      expect(result).toEqual({
        type: "item.completed",
        item: {
          type: "command_execution",
          id: "call-1",
          command: "echo hi",
          aggregated_output: "hi\n",
          status: "completed",
        },
      });
    },
  );

  it("preserves non-completed command status", () => {
    const result = translateItemNotification(
      "item/completed",
      {
        item: {
          type: "commandExecution",
          id: "call-1",
          command: "false",
          aggregatedOutput: "",
          status: "failed",
        },
      },
    );
    expect(
      (result?.item as Record<string, unknown>).status,
    ).toBe("failed");
  });
});

describe("codex-translate: turn lifecycle", () => {
  it("translates completed turn", () => {
    const r = translateTurnCompleted({
      turn: {
        id: "tu-1", status: "completed", items: [],
      },
    });
    expect(r.event).toEqual({
      type: "turn.completed",
    });
    expect(r.turnFailed).toBe(false);
  });

  it("translates failed turn", () => {
    const r = translateTurnCompleted({
      turn: {
        id: "tu-1",
        status: "failed",
        error: { message: "rate limit" },
      },
    });
    expect(r.event).toEqual({
      type: "turn.failed",
      error: { message: "rate limit" },
    });
    expect(r.turnFailed).toBe(true);
  });

  it("supplies default error message", () => {
    const r = translateTurnCompleted({
      turn: { status: "failed" },
    });
    expect(
      ((r.event.error) as Record<string, unknown>)
        .message,
    ).toBe("Turn failed");
  });
});

describe("codex-translate: method allowlist", () => {
  it("includes terminalInteraction", () => {
    expect(
      isTranslatedMethod(
        "item/commandExecution/terminalInteraction",
      ),
    ).toBe(true);
  });

  it("includes outputDelta", () => {
    expect(
      isTranslatedMethod(
        "item/commandExecution/outputDelta",
      ),
    ).toBe(true);
  });

  it("rejects unknown methods", () => {
    expect(
      isTranslatedMethod("mcpServer/startupStatus/updated"),
    ).toBe(false);
    expect(
      isTranslatedMethod("thread/tokenUsage/updated"),
    ).toBe(false);
  });
});
