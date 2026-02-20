export type AgentVendor = "claude" | "codex" | "gemini" | "unknown";

interface TerminalFailureGuidanceBase {
  title: string;
  toast: string;
  steps: string[];
}

export interface AuthTerminalFailureGuidance extends TerminalFailureGuidanceBase {
  kind: "auth";
}

export interface MissingCwdTerminalFailureGuidance extends TerminalFailureGuidanceBase {
  kind: "missing_cwd";
  missingPath: string | null;
  previousSessionId: string | null;
}

export type TerminalFailureGuidance =
  | AuthTerminalFailureGuidance
  | MissingCwdTerminalFailureGuidance;

const AUTH_FAILURE_PATTERNS: RegExp[] = [
  /\boauth token has expired\b/i,
  /\bauthentication_error\b/i,
  /\bauthentication_failed\b/i,
  /\bfailed to authenticate\b/i,
  /\bapi error:\s*401\b/i,
  /\bstatus code\s*401\b/i,
  /\bunauthorized\b/i,
];

const MISSING_CWD_PATH_PATTERNS: RegExp[] = [
  /path\s+["']([^"']+)["']\s+does not exist/i,
  /cwd(?:\s+path)?\s+["']([^"']+)["']\s+does not exist/i,
  /enoent:[^\n]*(?:chdir|cwd)[^\n]*["']([^"']+)["']/i,
];

const SESSION_ID_PATTERNS: RegExp[] = [
  /"session_id"\s*:\s*"([a-z0-9-]+)"/gi,
  /session_id\s*:\s*([a-z0-9-]+)/gi,
];

const ANSI_ESCAPE_PATTERN = /\u001b\[[0-9;]*m/g;

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

function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE_PATTERN, "");
}

function normalizeFailureText(text: string): string {
  return stripAnsi(text)
    .replace(/\\"/g, "\"")
    .replace(/\\'/g, "'");
}

function extractMissingPath(text: string): string | null {
  for (const pattern of MISSING_CWD_PATH_PATTERNS) {
    const match = text.match(pattern);
    const candidate = match?.[1]?.trim();
    if (candidate) return candidate;
  }
  return null;
}

function extractPreviousSessionId(text: string): string | null {
  let last: string | null = null;
  for (const pattern of SESSION_ID_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const candidate = match[1]?.trim();
      if (candidate) last = candidate;
    }
  }
  return last;
}

function isMissingCwdFailure(text: string): boolean {
  const hasMissingPath = MISSING_CWD_PATH_PATTERNS.some((pattern) => pattern.test(text));
  if (!hasMissingPath) return false;
  return /\berror_during_execution\b/i.test(text) || /\bworktree\b/i.test(text) || /\bcwd\b/i.test(text);
}

export function classifyTerminalFailure(
  text: string,
  agentCommand?: string
): TerminalFailureGuidance | null {
  if (!text) return null;
  const normalized = normalizeFailureText(text);

  if (isMissingCwdFailure(normalized)) {
    const missingPath = extractMissingPath(normalized);
    const previousSessionId = extractPreviousSessionId(normalized);
    return {
      kind: "missing_cwd",
      title: "Follow-up failed because the prior worktree path is missing",
      toast: "Ship follow-up failed because the previous worktree path no longer exists.",
      steps: [
        missingPath
          ? `The missing path was: ${missingPath}`
          : "The follow-up prompt referenced a worktree path that no longer exists.",
        previousSessionId
          ? `Use Retry to relaunch from repo state and include prior session ${previousSessionId} as context.`
          : "Use Retry to relaunch from current repository state.",
        "If retry still fails, check whether the worktree cleanup happened before all follow-up prompts finished.",
      ],
      missingPath,
      previousSessionId,
    };
  }

  if (!isAuthFailure(normalized)) return null;

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
