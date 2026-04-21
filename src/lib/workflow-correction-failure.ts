/**
 * Loud-failure plumbing for descriptive workflow-correction misuse.
 *
 * `markTerminal` is an explicit correction action: skip to a terminal
 * state regardless of normal workflow adjacency. Misuse — an unknown
 * profile, a non-terminal target, an unknown beat — must never silently
 * succeed or downgrade to a warning. This module provides the error
 * type and red banner mirror of `dispatch-pool-resolver.ts` so the two
 * failure modes share shape and style.
 *
 * See CLAUDE.md §"Fail Loudly, Never Silently".
 */

/** Greppable marker phrase emitted by every correction failure. */
export const WORKFLOW_CORRECTION_FAILURE_MARKER =
  "FOOLERY WORKFLOW CORRECTION FAILURE";

/** ANSI SGR colors used for the unmissable banner. */
const ANSI_RED_BG_WHITE = "\x1b[41;37;1m";
const ANSI_RESET = "\x1b[0m";

export interface WorkflowCorrectionFailureInfo {
  beatId: string;
  profileId: string;
  targetState: string;
  allowedTerminals: ReadonlyArray<string>;
  reason: "unknown_profile" | "non_terminal_target";
}

function buildBanner(inner: string): string {
  const lines = inner.split("\n");
  const width = Math.min(
    120,
    Math.max(...lines.map((l) => l.length), 40),
  );
  const edge = "═".repeat(width + 4);
  const top = `╔${edge}╗`;
  const bottom = `╚${edge}╝`;
  const middle = lines
    .map((l) => `║  ${l.padEnd(width)}  ║`)
    .join("\n");
  return [top, middle, bottom].join("\n");
}

function remediation(info: WorkflowCorrectionFailureInfo): string {
  const base = "  remediation  =";
  if (info.reason === "unknown_profile") {
    return (
      `${base} resolve the beat's profile ('${info.profileId}') `
      + "to a valid workflow profile before calling markTerminal."
    );
  }
  const list = info.allowedTerminals.length > 0
    ? info.allowedTerminals.join(", ")
    : "<none>";
  return (
    `${base} pass targetState from the profile's terminalStates `
    + `(allowed: [${list}]); use the generic update() path for `
    + "non-terminal state changes."
  );
}

/**
 * Build the unmissable red banner. Writes to console.error AND returns
 * the banner string so callers can surface it to session buffers too.
 */
export function emitWorkflowCorrectionFailureBanner(
  info: WorkflowCorrectionFailureInfo,
): string {
  const heading =
    `${WORKFLOW_CORRECTION_FAILURE_MARKER}: cannot correct beat `
    + `${info.beatId}`;
  const body = [
    `  profile      = ${info.profileId}`,
    `  targetState  = ${info.targetState}`,
    `  allowed      = [${info.allowedTerminals.join(", ")}]`,
    `  reason       = ${info.reason}`,
    remediation(info),
  ].join("\n");

  const plain = [heading, body].join("\n");
  const banner = buildBanner(plain);

  console.error(
    `\n${ANSI_RED_BG_WHITE}${banner}${ANSI_RESET}\n`,
  );
  return `\n${ANSI_RED_BG_WHITE}${banner}${ANSI_RESET}\n`;
}

/** Error thrown by `markTerminal` on descriptive-correction misuse. */
export class WorkflowCorrectionFailureError extends Error {
  readonly info: WorkflowCorrectionFailureInfo;
  readonly banner: string;
  constructor(info: WorkflowCorrectionFailureInfo) {
    const banner = emitWorkflowCorrectionFailureBanner(info);
    const reasonPhrase =
      info.reason === "unknown_profile"
        ? `profile '${info.profileId}' is not resolvable`
        : `target '${info.targetState}' is not a terminal of `
          + `profile '${info.profileId}' (allowed: `
          + `[${info.allowedTerminals.join(", ")}])`;
    super(
      `${WORKFLOW_CORRECTION_FAILURE_MARKER}: beat=${info.beatId} `
      + reasonPhrase,
    );
    this.name = "WorkflowCorrectionFailureError";
    this.info = info;
    this.banner = banner;
  }
}
