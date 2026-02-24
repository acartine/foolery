import { describe, it, expect } from "vitest";
import { createLineNormalizer } from "@/lib/agent-adapter";

describe("Codex plan parsing through assistant events", () => {
  it("normalizer preserves agent_message text containing NDJSON plan events", () => {
    const normalize = createLineNormalizer("codex");
    const planLine = JSON.stringify({
      event: "plan_final",
      plan: {
        summary: "Test plan",
        waves: [
          {
            wave_index: 1,
            name: "Setup",
            objective: "init",
            beads: [{ title: "Task 1", type: "task", priority: 2 }],
          },
        ],
        assumptions: [],
      },
    });

    const result = normalize({
      type: "item.completed",
      item: { id: "msg_1", type: "agent_message", text: planLine },
    });

    expect(result).not.toBeNull();
    expect(result!.type).toBe("assistant");
    // The text should contain the plan_final NDJSON
    const content = (result!.message as { content: { text: string }[] }).content;
    expect(content[0].text).toContain('"plan_final"');
  });

  it("accumulated text in turn.completed contains all agent messages", () => {
    const normalize = createLineNormalizer("codex");

    normalize({
      type: "item.completed",
      item: {
        id: "msg_1",
        type: "agent_message",
        text: "Thinking about the plan...",
      },
    });

    const planJson = JSON.stringify({
      event: "plan_final",
      plan: {
        summary: "Test",
        waves: [
          {
            wave_index: 1,
            name: "W1",
            objective: "obj",
            beads: [{ title: "T", type: "task", priority: 2 }],
          },
        ],
        assumptions: [],
      },
    });

    normalize({
      type: "item.completed",
      item: { id: "msg_2", type: "agent_message", text: planJson },
    });

    const result = normalize({ type: "turn.completed", usage: {} });
    expect(result).not.toBeNull();
    expect(result!.type).toBe("result");
    const resultText = (result as { result: string }).result;
    expect(resultText).toContain("Thinking about the plan...");
    expect(resultText).toContain('"plan_final"');
  });

  it("tagged JSON in agent_message is preserved for extraction", () => {
    const normalize = createLineNormalizer("codex");

    const taggedPlan = [
      "<breakdown_plan_json>",
      JSON.stringify({
        summary: "Test",
        waves: [
          {
            wave_index: 1,
            name: "Setup",
            objective: "init",
            beads: [{ title: "Task 1", type: "task", priority: 2 }],
          },
        ],
        assumptions: [],
      }),
      "</breakdown_plan_json>",
    ].join("\n");

    normalize({
      type: "item.completed",
      item: { id: "msg_1", type: "agent_message", text: taggedPlan },
    });

    const result = normalize({ type: "turn.completed", usage: {} });
    const resultText = (result as { result: string }).result;
    expect(resultText).toContain("<breakdown_plan_json>");
    expect(resultText).toContain("</breakdown_plan_json>");
  });

  it("multiple agent_messages accumulate (not replace) in turn result", () => {
    const normalize = createLineNormalizer("codex");

    normalize({
      type: "item.completed",
      item: { id: "msg_1", type: "agent_message", text: "First message" },
    });

    normalize({
      type: "item.completed",
      item: { id: "msg_2", type: "agent_message", text: "Second message" },
    });

    normalize({
      type: "item.completed",
      item: { id: "msg_3", type: "agent_message", text: "Third message" },
    });

    const result = normalize({ type: "turn.completed", usage: {} });
    const resultText = (result as { result: string }).result;
    expect(resultText).toContain("First message");
    expect(resultText).toContain("Second message");
    expect(resultText).toContain("Third message");
  });

  it("Claude assistant events are idempotent pass-through", () => {
    const normalize = createLineNormalizer("claude");

    // Claude normalizer is pass-through; events are returned as-is
    const event = {
      type: "assistant",
      message: {
        content: [{ type: "text", text: "some plan content" }],
      },
    };

    const result = normalize(event);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("assistant");
    // Feeding the same event again should produce the same output
    const result2 = normalize(event);
    expect(result2).toEqual(result);
  });

  it("wave_draft NDJSON in agent_message is preserved line-by-line", () => {
    const normalize = createLineNormalizer("codex");

    const waveDraftLine = JSON.stringify({
      event: "wave_draft",
      wave: {
        wave_index: 1,
        name: "Foundation",
        objective: "Set up base",
        beads: [{ title: "Init project", type: "task", priority: 1 }],
      },
    });

    const result = normalize({
      type: "item.completed",
      item: { id: "msg_1", type: "agent_message", text: waveDraftLine },
    });

    expect(result).not.toBeNull();
    const content = (result!.message as { content: { text: string }[] }).content;
    expect(content[0].text).toContain('"wave_draft"');

    // Verify accumulated in turn result
    const turnResult = normalize({ type: "turn.completed", usage: {} });
    const resultText = (turnResult as { result: string }).result;
    expect(resultText).toContain('"wave_draft"');
  });
});
