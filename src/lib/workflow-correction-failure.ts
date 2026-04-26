/**
 * Loud-failure plumbing for descriptive workflow-correction misuse.
 *
 * Two correction primitives live in this module's error space:
 *
 *  - `markTerminal` — skip a beat to a terminal state. Misuse =
 *    `WorkflowCorrectionFailureError` (unknown profile / non-terminal
 *    target).
 *  - `rewind` — walk a beat back to an earlier queue state. This is a
 *    HACKISH FAT-FINGER CORRECTION TOOL, not a primary workflow action;
 *    it exists solely to recover beats that were over-shot forward
 *    (e.g. accidentally marked Shipped) or orphaned in an action state
 *    with no legal kno transition home. Misuse =
 *    `WorkflowRewindFailureError` (unknown profile / non-queue target /
 *    forward-direction target).
 *
 * Both share the greppable marker `FOOLERY WORKFLOW CORRECTION FAILURE`
 * and emit a red banner mirror of `dispatch-pool-resolver.ts`. Misuse
 * must never silently succeed or downgrade to a warning.
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

// ── Rewind failure (hackish fat-finger correction) ──────────────────

export interface WorkflowRewindFailureInfo {
  beatId: string;
  profileId: string;
  currentState: string;
  targetState: string;
  allowedRewindTargets: ReadonlyArray<string>;
  reason:
    | "unknown_profile"
    | "non_queue_target"
    | "not_earlier_than_current";
}

function rewindRemediation(info: WorkflowRewindFailureInfo): string {
  const base = "  remediation  =";
  if (info.reason === "unknown_profile") {
    return (
      `${base} resolve the beat's profile ('${info.profileId}') `
      + "to a valid workflow profile before calling rewind."
    );
  }
  const list = info.allowedRewindTargets.length > 0
    ? info.allowedRewindTargets.join(", ")
    : "<none>";
  if (info.reason === "non_queue_target") {
    return (
      `${base} pass targetState from the profile's earlier queue `
      + `states (allowed: [${list}]); rewind only walks backward to `
      + "states the loom marks as queue states (descriptor."
      + "queueStates). Use the generic update() path for "
      + "kno-sanctioned forward transitions."
    );
  }
  return (
    `${base} target '${info.targetState}' is not strictly earlier than `
    + `current state '${info.currentState}' (allowed earlier queue `
    + `states: [${list}]). Rewind never advances or stays put."`
  );
}

export function emitWorkflowRewindFailureBanner(
  info: WorkflowRewindFailureInfo,
): string {
  const heading =
    `${WORKFLOW_CORRECTION_FAILURE_MARKER}: cannot rewind beat `
    + `${info.beatId}`;
  const body = [
    `  profile      = ${info.profileId}`,
    `  currentState = ${info.currentState}`,
    `  targetState  = ${info.targetState}`,
    `  allowed      = [${info.allowedRewindTargets.join(", ")}]`,
    `  reason       = ${info.reason}`,
    rewindRemediation(info),
  ].join("\n");

  const plain = [heading, body].join("\n");
  const banner = buildBanner(plain);

  console.error(
    `\n${ANSI_RED_BG_WHITE}${banner}${ANSI_RESET}\n`,
  );
  return `\n${ANSI_RED_BG_WHITE}${banner}${ANSI_RESET}\n`;
}

/**
 * Error thrown by the rewind correction primitive on misuse. Rewind is
 * a fat-finger recovery tool — it MUST refuse forward jumps, terminal
 * targets, action-state targets, and unknown profiles, and it MUST
 * surface those refusals via a red `FOOLERY WORKFLOW CORRECTION
 * FAILURE` banner so the misuse is impossible to overlook in logs.
 */
export class WorkflowRewindFailureError extends Error {
  readonly info: WorkflowRewindFailureInfo;
  readonly banner: string;
  constructor(info: WorkflowRewindFailureInfo) {
    const banner = emitWorkflowRewindFailureBanner(info);
    const reasonPhrase = (() => {
      if (info.reason === "unknown_profile") {
        return `profile '${info.profileId}' is not resolvable`;
      }
      if (info.reason === "non_queue_target") {
        return (
          `target '${info.targetState}' is not an earlier queue state `
          + `of profile '${info.profileId}' (allowed: `
          + `[${info.allowedRewindTargets.join(", ")}])`
        );
      }
      return (
        `target '${info.targetState}' is not strictly earlier than `
        + `current state '${info.currentState}' in profile `
        + `'${info.profileId}'`
      );
    })();
    super(
      `${WORKFLOW_CORRECTION_FAILURE_MARKER}: beat=${info.beatId} `
      + reasonPhrase,
    );
    this.name = "WorkflowRewindFailureError";
    this.info = info;
    this.banner = banner;
  }
}
