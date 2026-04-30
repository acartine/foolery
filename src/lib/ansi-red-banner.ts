/**
 * Pure ANSI red-banner builder. Zero dependencies — safe to import
 * from any module without dragging in the workflow / pool runtime.
 *
 * Used by dispatch-pool-resolver (FOOLERY DISPATCH FAILURE) and
 * dispatch-forensics-classify (FOOLERY DISPATCH FORENSIC) to render
 * the same loud red box around failure / forensic banners.
 *
 * Kept in its own file (not in dispatch-pool-resolver) because tests
 * that mock `@/lib/workflows` cannot tolerate the agent-pool /
 * WorkflowStep import chain that resolver pulls in.
 */

const ANSI_RED_BG_WHITE = "\x1b[41;37;1m";
const ANSI_RESET = "\x1b[0m";

/**
 * Wrap multi-line text in a Unicode-box-drawing red banner. Width is
 * computed from the longest line, capped at 120 columns so wide
 * paragraphs don't blow out narrow terminals.
 */
export function buildAnsiRedBanner(inner: string): string {
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
  const box = [top, middle, bottom].join("\n");
  return `${ANSI_RED_BG_WHITE}${box}${ANSI_RESET}`;
}
