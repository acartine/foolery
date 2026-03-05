import type { AgentTarget } from "@/lib/types-agent-target";
import type { SessionRuntimeHandle, SessionRuntimePort, RuntimeSessionContext } from "@/lib/session-runtime";
import { LocalWorkerService } from "@/lib/local-worker";
import { loadSettings } from "@/lib/settings";
import { resolveStep, StepPhase } from "@/lib/workflows";

interface OpenRouterMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

const WORKER_TOOL_DEFS = [
  tool("fs_read", "Read a file from the repo", { path: "string" }),
  tool("fs_write_patch", "Apply a unified diff patch to a file", { path: "string", patch: "string" }),
  tool("fs_search", "Search for text inside repo files", { path: "string", pattern: "string" }),
  tool("shell_exec", "Run a safe shell command in the repo", { command: "string" }),
  tool("memory_show", "Show the current beat", {}),
  tool("memory_list_children", "List child beats for the current beat", {}),
  tool("memory_list_dependencies", "List dependencies for the current beat", {}),
  tool("memory_add_note", "Add an implementation note to the current beat", { note: "string" }),
];

function tool(name: string, description: string, props: Record<string, string>) {
  return {
    type: "function",
    function: {
      name,
      description,
      parameters: {
        type: "object",
        properties: Object.fromEntries(
          Object.entries(props).map(([key, value]) => [key, { type: value }]),
        ),
      },
    },
  };
}

function formatLeasePrompt(context: RuntimeSessionContext, taskPrompt: string): string {
  if (context.customPrompt) return context.customPrompt;
  if (context.isParent) {
    return [
      "You are executing a parent beat and its children.",
      "Edit files directly, run tests/builds as needed, and use memory tools instead of memory-manager CLIs.",
      context.queueTerminalInvariantInstruction,
      "",
      taskPrompt,
    ].join("\n");
  }
  return [
    "Implement the following task by editing files directly.",
    "Use the available worker tools for repo inspection, patching, shell commands, and beat metadata.",
    context.queueTerminalInvariantInstruction,
    "",
    taskPrompt,
  ].join("\n");
}

function buildSystemPrompt(repoPath?: string): string {
  return [
    "You are Foolery's OpenRouter execution worker.",
    "Operate non-interactively, make reasonable assumptions, and continue until the current task iteration is complete or blocked by a hard error.",
    "Never ask the user to run memory-manager commands. Use worker tools instead.",
    repoPath ? `Repository root: ${repoPath}` : null,
  ].filter(Boolean).join("\n");
}

export class OpenRouterSessionRuntime implements SessionRuntimePort {
  constructor(
    private readonly worker = new LocalWorkerService(),
  ) {}

  async startTake(agent: AgentTarget, context: RuntimeSessionContext): Promise<SessionRuntimeHandle> {
    if (agent.kind !== "openrouter") {
      throw new Error("OpenRouterSessionRuntime requires an openrouter agent target");
    }

    this.worker.createSession(context.session.id);
    const run = async () => {
      try {
        if (context.isParent && context.childBeatIds.length > 0) {
          await Promise.all(
            context.childBeatIds.map((childBeatId) =>
              this.runSingleTake(agent, context, childBeatId),
            ),
          );
          context.finishSession(0);
          return;
        }

        await this.runSingleTake(agent, context, context.beatId);
        context.finishSession(0);
      } catch (error) {
        context.pushEvent({
          type: "stderr",
          data: `${error instanceof Error ? error.message : String(error)}\n`,
          timestamp: Date.now(),
        });
        context.finishSession(1);
      } finally {
        this.worker.completeSession(context.session.id);
      }
    };

    void run();
    return {
      abort: () => this.worker.abortSession(context.session.id),
    };
  }

  private async runSingleTake(
    agent: AgentTarget,
    context: RuntimeSessionContext,
    beatId: string,
  ): Promise<void> {
    const maxIterations = 10;
    let iterations = 0;

    while (iterations < maxIterations) {
      const prepared = await this.worker.prepareTake({
        beatId,
        repoPath: context.repoPath,
        isParent: false,
        childBeatIds: [],
      });
      if (!prepared.ok || !prepared.data) {
        throw new Error(prepared.error?.message ?? `Failed to prepare take for ${beatId}`);
      }

      const taskPrompt = formatLeasePrompt(context, prepared.data.prompt);
      context.pushEvent({
        type: "stdout",
        data: `\x1b[36m--- Take ${iterations + 1}/${maxIterations} [${beatId}] ---\x1b[0m\n`,
        timestamp: Date.now(),
      });
      context.interactionLog.logPrompt(taskPrompt, { source: `take_${iterations + 1}` });
      await this.executeLease(agent, context, prepared.data, taskPrompt);

      const completed = await this.worker.completeIteration(prepared.data.leaseId);
      if (!completed.ok || !completed.data) {
        throw new Error(completed.error?.message ?? `Failed to complete iteration for ${beatId}`);
      }

      const snapshot = completed.data;
      const resolved = resolveStep(snapshot.beat.state);
      const owner = resolved ? snapshot.workflow.owners?.[resolved.step] ?? snapshot.beat.nextActionOwnerKind ?? "agent" : "none";
      if (
        snapshot.workflow.terminalStates.includes(snapshot.beat.state) ||
        !resolved ||
        resolved.phase !== StepPhase.Queued ||
        owner !== "agent" ||
        snapshot.beat.isAgentClaimable === false
      ) {
        return;
      }

      iterations += 1;
    }

    throw new Error(`Take loop stopped after ${maxIterations} iterations for ${beatId}`);
  }

  private async executeLease(
    agent: AgentTarget,
    context: RuntimeSessionContext,
    lease: { leaseId: string; beatId: string },
    prompt: string,
  ): Promise<void> {
    const settings = await loadSettings();
    const apiKey = settings.openrouter.apiKey;
    if (!apiKey) throw new Error("OpenRouter is enabled for execution but no API key is configured");

    const messages: OpenRouterMessage[] = [
      { role: "system", content: buildSystemPrompt(context.repoPath) },
      { role: "user", content: prompt },
    ];

    for (let turns = 0; turns < 24; turns++) {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://github.com/acartine/foolery",
          "X-Title": "Foolery",
        },
        body: JSON.stringify({
          model: agent.model,
          messages,
          tools: WORKER_TOOL_DEFS,
          tool_choice: "auto",
        }),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`OpenRouter returned ${response.status}: ${body || response.statusText}`);
      }

      const json = await response.json() as {
        choices?: Array<{
          message?: OpenRouterMessage;
          finish_reason?: string | null;
        }>;
      };
      const choice = json.choices?.[0];
      const message = choice?.message;
      if (!message) throw new Error("OpenRouter returned no message");

      if (message.content) {
        context.interactionLog.logResponse(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: message.content }] } }));
        context.pushEvent({ type: "stdout", data: `${message.content}\n`, timestamp: Date.now() });
      }

      if (message.tool_calls?.length) {
        messages.push({ role: "assistant", tool_calls: message.tool_calls });
        for (const call of message.tool_calls) {
          const args = this.parseToolArgs(call.function.arguments);
          context.pushEvent({
            type: "stdout",
            data: `\x1b[90m[tool] ${call.function.name}\x1b[0m\n`,
            timestamp: Date.now(),
          });
          const result = await this.worker.runTool(
            { name: call.function.name as never, input: args },
            lease.beatId,
            context.repoPath,
          );
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: result.content,
          });
          context.interactionLog.logResponse(JSON.stringify({
            type: "user",
            message: { content: [{ type: "tool_result", content: result.content }] },
          }));
        }
        continue;
      }

      return;
    }

    throw new Error(`OpenRouter runtime exceeded tool-call turn limit for ${lease.beatId}`);
  }

  private parseToolArgs(raw: string): Record<string, unknown> {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
}
