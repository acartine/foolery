export type AgentVendor = "claude" | "codex" | "gemini" | "unknown";

export interface TerminalFailureGuidance {
  kind: "auth";
  title: string;
  toast: string;
  steps: string[];
}

const AUTH_FAILURE_PATTERNS: RegExp[] = [
  /\boauth token has expired\b/i,
  /\bauthentication_error\b/i,
  /\bauthentication_failed\b/i,
  /\bfailed to authenticate\b/i,
  /\bapi error:\s*401\b/i,
  /\bstatus code\s*401\b/i,
  /\bunauthorized\b/i,
];

export function detectAgentVendor(command: string | undefined): AgentVendor {
  const lower = (command ?? "").toLowerCase();
  if (lower.includes("claude")) return "claude";
  if (lower.includes("codex")) return "codex";
  if (lower.includes("gemini")) return "gemini";
  return "unknown";
}

function commandToken(command: string | undefined): string | null {
  const trimmed = (command ?? "").trim();
  if (!trimmed) return null;
  const first = trimmed.split(/\s+/)[0];
  if (!first) return null;
  const parts = first.split("/");
  return parts[parts.length - 1] || first;
}

function authLoginHint(command: string | undefined): string {
  const token = commandToken(command);
  const vendor = detectAgentVendor(command);

  if (vendor === "claude") {
    return token
      ? `Run \`${token} login\` to refresh your credentials.`
      : "Run your Claude CLI login command to refresh credentials.";
  }
  if (vendor === "codex") {
    return token
      ? `Run \`${token} login\` (or your Codex auth flow) to refresh credentials.`
      : "Run your Codex CLI login/auth flow to refresh credentials.";
  }
  if (vendor === "gemini") {
    return token
      ? `Run \`${token} auth login\` (or your Gemini auth flow) to refresh credentials.`
      : "Run your Gemini CLI login/auth flow to refresh credentials.";
  }
  if (token) {
    return `Re-authenticate the configured agent CLI (\`${token}\`) and retry.`;
  }
  return "Re-authenticate the configured agent CLI and retry.";
}

function isAuthFailure(text: string): boolean {
  return AUTH_FAILURE_PATTERNS.some((pattern) => pattern.test(text));
}

export function classifyTerminalFailure(
  text: string,
  agentCommand?: string
): TerminalFailureGuidance | null {
  if (!text || !isAuthFailure(text)) return null;

  return {
    kind: "auth",
    title: "Agent authentication failed",
    toast: "Agent authentication failed. Re-authenticate the agent CLI, then retry Scene.",
    steps: [
      authLoginHint(agentCommand),
      "Retry the same Scene/Take action after login succeeds.",
      "If it still fails, open Settings -> Agents and verify the configured command and model.",
    ],
  };
}
