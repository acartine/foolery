import { describe, it, expect } from "vitest";
import {
  createCodexJsonRpcSession,
} from "@/lib/codex-jsonrpc-session";

// Delta-event regression tests for the Codex JSON-RPC
// adapter. Live Codex builds carry incremental text in
// `params.delta`; older docs use `params.text`. Both
// must surface as visible non-empty `item.delta` events
// for the terminal Detail stream and history console.

// ── agentMessage/delta ───────────────────────────────

describe("codex-jsonrpc: agentMessage/delta", () => {
  it(
    "params.delta yields non-empty item.delta text",
    () => {
      const session = createCodexJsonRpcSession();
      const result = session.processLine({
        method: "item/agentMessage/delta",
        params: {
          threadId: "t-1", turnId: "turn-1",
          itemId: "msg-1",
          delta: "hello world",
        },
      });
      expect(result).toEqual({
        type: "item.delta",
        item: { type: "agent_message", id: "msg-1" },
        text: "hello world",
      });
    },
  );

  it(
    "params.text and params.delta produce equivalent " +
    "item.delta text",
    () => {
      const session = createCodexJsonRpcSession();
      const fromDelta = session.processLine({
        method: "item/agentMessage/delta",
        params: { delta: "hi there" },
      });
      const fromText = session.processLine({
        method: "item/agentMessage/delta",
        params: { text: "hi there" },
      });
      expect(fromDelta).toEqual(fromText);
      expect(fromText).toEqual({
        type: "item.delta",
        item: {
          type: "agent_message", id: undefined,
        },
        text: "hi there",
      });
    },
  );

  it("drops empty delta and missing payload", () => {
    const session = createCodexJsonRpcSession();
    expect(session.processLine({
      method: "item/agentMessage/delta",
      params: {},
    })).toBeNull();
    expect(session.processLine({
      method: "item/agentMessage/delta",
      params: { delta: "" },
    })).toBeNull();
  });
});

// ── commandExecution/outputDelta ─────────────────────

describe(
  "codex-jsonrpc: commandExecution/outputDelta",
  () => {
    it(
      "params.delta surfaces non-empty " +
      "command output as item.delta",
      () => {
        const session = createCodexJsonRpcSession();
        const result = session.processLine({
          method:
            "item/commandExecution/outputDelta",
          params: {
            threadId: "t-1", turnId: "turn-1",
            itemId: "call-1",
            delta: "stdout chunk",
          },
        });
        expect(result).toEqual({
          type: "item.delta",
          item: {
            type: "command_execution", id: "call-1",
          },
          text: "stdout chunk",
        });
      },
    );

    it(
      "params.text and params.delta produce " +
      "equivalent command output events",
      () => {
        const session = createCodexJsonRpcSession();
        const fromDelta = session.processLine({
          method:
            "item/commandExecution/outputDelta",
          params: { delta: "abc" },
        });
        const fromText = session.processLine({
          method:
            "item/commandExecution/outputDelta",
          params: { text: "abc" },
        });
        expect(fromDelta).toEqual(fromText);
        expect(fromText).toEqual({
          type: "item.delta",
          item: {
            type: "command_execution",
            id: undefined,
          },
          text: "abc",
        });
      },
    );

    it("drops empty payload", () => {
      const session = createCodexJsonRpcSession();
      expect(session.processLine({
        method: "item/commandExecution/outputDelta",
        params: {},
      })).toBeNull();
    });
  },
);

// ── reasoning text/summaryText delta ─────────────────

describe("codex-jsonrpc: reasoning textDelta", () => {
  it(
    "textDelta and summaryTextDelta accept both " +
    "delta and text",
    () => {
      const session = createCodexJsonRpcSession();
      const fromDelta = session.processLine({
        method: "item/reasoning/textDelta",
        params: { delta: "thinking..." },
      });
      const fromText = session.processLine({
        method: "item/reasoning/summaryTextDelta",
        params: { text: "thinking..." },
      });
      expect(fromDelta).toEqual({
        type: "item.delta",
        item: { type: "reasoning", id: undefined },
        text: "thinking...",
      });
      expect(fromText).toEqual(fromDelta);
    },
  );
});

// ── empty reasoning item/completed ───────────────────

describe(
  "codex-jsonrpc: empty reasoning item/completed",
  () => {
    it(
      "drops empty reasoning so terminal does not " +
      "render `(no text)` content_block_delta",
      () => {
        const session = createCodexJsonRpcSession();
        const result = session.processLine({
          method: "item/completed",
          params: {
            threadId: "t-1", turnId: "turn-1",
            item: {
              id: "item-empty",
              type: "reasoning",
              summaryParts: [],
            },
          },
        });
        expect(result).toBeNull();
      },
    );

    it(
      "drops reasoning whose summaryParts have " +
      "no text content",
      () => {
        const session = createCodexJsonRpcSession();
        const result = session.processLine({
          method: "item/completed",
          params: {
            threadId: "t-1", turnId: "turn-1",
            item: {
              id: "item-empty-2",
              type: "reasoning",
              summaryParts: [
                { type: "summaryText", text: "" },
              ],
            },
          },
        });
        expect(result).toBeNull();
      },
    );
  },
);
