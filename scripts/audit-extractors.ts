/**
 * AUDIT: run every per-provider extractor against every realistic input
 * from the user's settings.toml. Print the canonical normalized output.
 *
 * This is the proof-of-correctness exercise the user demanded:
 * "Have you literally reviewed every single agent metadata parse command
 *  for every single provider type to make sure they work correctly and
 *  authoritatively?"
 *
 * Run:  bun run scripts/audit-extractors.ts
 */
import {
  normalizeAgentIdentity,
  formatAgentDisplayLabel,
  parseAgentDisplayParts,
} from "@/lib/agent-identity";
import { toCanonicalAgentConfig } from "@/lib/agent-identity-canonical";

interface Case {
  command: string;
  model: string;
  desc: string;
}

const CASES: Case[] = [
  // Codex family — every shape from settings.toml + likely additions
  { command: "codex", model: "gpt-5.5", desc: "Codex GPT 5.5" },
  { command: "codex", model: "gpt-5.4", desc: "Codex GPT 5.4" },
  { command: "codex", model: "gpt-5.4-mini", desc: "Codex GPT 5.4 Mini" },
  { command: "codex", model: "gpt-5.3-codex-spark", desc: "Codex GPT 5.3 Spark" },
  { command: "codex", model: "gpt-5.3-codex-mini", desc: "Codex GPT 5.3 Mini variant" },
  { command: "codex", model: "gpt-5-codex-max", desc: "Codex GPT 5 Max" },
  { command: "codex", model: "chatgpt-5.5", desc: "Codex ChatGPT" },

  // Claude family
  { command: "claude", model: "claude-opus-4-7", desc: "Claude Opus 4.7" },
  { command: "claude", model: "claude-sonnet-4-6", desc: "Claude Sonnet 4.6" },
  { command: "claude", model: "claude-haiku-4-5", desc: "Claude Haiku 4.5" },
  { command: "claude", model: "claude-opus-4-7-1m", desc: "Claude Opus 1M context" },
  { command: "claude", model: "claude-sonnet-4-5-fast", desc: "Claude Sonnet Fast" },

  // Gemini
  { command: "gemini", model: "gemini-2.5-pro", desc: "Gemini 2.5 Pro" },
  { command: "gemini", model: "gemini-2.5-flash", desc: "Gemini 2.5 Flash" },
  { command: "gemini", model: "gemini-2.5-flash-lite", desc: "Gemini 2.5 Flash Lite" },
  { command: "gemini", model: "gemini-3-pro-preview", desc: "Gemini 3 Pro Preview" },

  // Copilot delegates
  { command: "copilot", model: "claude-sonnet-4-5", desc: "Copilot routing Claude" },
  { command: "copilot", model: "gpt-5.5", desc: "Copilot routing GPT" },
  { command: "copilot", model: "gemini-2.5-pro", desc: "Copilot routing Gemini" },

  // OpenCode / OpenRouter paths (from user's settings.toml)
  { command: "opencode", model: "openrouter/moonshotai/kimi-k2.6", desc: "OpenCode Kimi" },
  { command: "opencode", model: "openrouter/anthropic/claude-sonnet-4-5", desc: "OpenCode Claude via Anthropic" },
  { command: "opencode", model: "openrouter/z-ai/glm-5.1", desc: "OpenCode GLM" },
  { command: "opencode", model: "openrouter/mistralai/devstral-2512", desc: "OpenCode Devstral" },
  { command: "opencode", model: "openrouter/minimax/minimax-m2.7", desc: "OpenCode Minimax" },
  { command: "opencode", model: "openrouter/google/gemini-2.5-pro", desc: "OpenCode Gemini via Google" },
  { command: "opencode", model: "kimi-k2.6", desc: "OpenCode bare model" },
];

function fmt(o: object): string {
  return JSON.stringify(o);
}

console.log("=".repeat(100));
console.log("AGENT METADATA EXTRACTION AUDIT");
console.log("=".repeat(100));
console.log();

for (const c of CASES) {
  const norm = normalizeAgentIdentity({ command: c.command, model: c.model });
  const canonical = toCanonicalAgentConfig({
    command: c.command,
    model: c.model,
  });
  const label = formatAgentDisplayLabel({
    command: c.command,
    model: c.model,
  });
  const parts = parseAgentDisplayParts({
    command: c.command,
    model: c.model,
  });

  console.log(`-- ${c.desc}`);
  console.log(`   input:        command=${c.command}, model=${c.model}`);
  console.log(`   normalize:    ${fmt(norm)}`);
  console.log(`   canonical:    ${fmt(canonical)}`);
  console.log(`   displayLabel: "${label}"`);
  console.log(`   pillParts:    label="${parts.label}" pills=${fmt(parts.pills)}`);
  console.log();
}
