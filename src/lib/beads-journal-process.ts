/** CLI transport for Beads 1.3 journals; deliberately bypasses legacy JSONL reads. */
import { execFile, spawn } from "node:child_process";
import { watch } from "node:fs";
import { join } from "node:path";
import { parseJournalRecord, type BeadsJournalRecord } from "./beads-journal";

export function journalCommandEnv(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...environment };
  // Journals live in the database. Legacy BD_NO_DB reads cannot supply them.
  delete env.BD_NO_DB;
  delete env.BD_JSON_ENVELOPE;
  return env;
}

function commandOptions(repoPath: string) {
  return { cwd: repoPath, env: journalCommandEnv(process.env) };
}

function commandArgs(args: string[]): string[] {
  return process.env.BD_DB ? ["--db", process.env.BD_DB, ...args] : args;
}

export function runJournalCommand(args: string[], repoPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(process.env.BD_BIN ?? "bd", commandArgs(args), {
      ...commandOptions(repoPath), timeout: 30_000, maxBuffer: 64 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error || /events.journal.*disabled|journal is (?:off|disabled)/i.test(stderr)) {
        reject(new Error(`${stderr}\n${stdout}\n${error?.message ?? ""}`.trim()));
      } else {
        resolve(stdout);
      }
    });
  });
}

export function journalUnavailable(message: string): boolean {
  return /unknown command ["']events["']|events.journal.*disabled|journal is (?:off|disabled)/i
    .test(message);
}

export function journalTruncationHead(message: string): number | undefined {
  // Initial CLI errors may be a pretty-printed JSON object.
  const start = message.indexOf("{");
  const end = message.lastIndexOf("}");
  if (start < 0 || end < start) return undefined;
  try {
    const error = JSON.parse(message.slice(start, end + 1));
    if (error.code === "events_journal_truncated"
      && Number.isSafeInteger(error.head) && error.head >= 0) return error.head;
  } catch { /* A non-JSON CLI error is reported by the caller. */ }
  return undefined;
}

export async function readJournalHead(repoPath: string): Promise<number | null> {
  try {
    const output = await runJournalCommand([
      "events", "tail", "--since", "0", "--json",
    ], repoPath);
    let head = 0;
    for (const line of output.split("\n")) {
      if (line.trim()) head = Math.max(head, parseJournalRecord(line).seq);
    }
    return head;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (journalUnavailable(message)) return null;
    const head = journalTruncationHead(message);
    if (head !== undefined) return head;
    throw error;
  }
}

export async function supportsJournalStdinLifetime(repoPath: string): Promise<boolean> {
  const help = await runJournalCommand(["events", "tail", "--help"], repoPath);
  return help.includes("--exit-on-stdin-eof");
}

export function followJournal(
  repoPath: string,
  sequence: number,
  onRecord: (record: BeadsJournalRecord) => void,
  onFailure: (message: string) => void,
  exitOnStdinEof = false,
): () => void {
  const child = spawn(process.env.BD_BIN ?? "bd", commandArgs([
    "events", "tail", "--since", String(sequence), "--follow", "--json",
    ...(exitOnStdinEof ? ["--exit-on-stdin-eof"] : []),
  ]), { ...commandOptions(repoPath), stdio: ["pipe", "pipe", "pipe"] });
  let stopped = false;
  let pending = "";
  let stderr = "";
  const fail = (message: string) => {
    if (stopped) return;
    stopped = true;
    child.kill();
    onFailure(message);
  };
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr = (stderr + chunk).slice(-16_384);
    if (journalUnavailable(stderr)) fail(stderr);
  });
  child.stdout.on("data", (chunk: string) => {
    pending += chunk;
    let newline: number;
    while ((newline = pending.indexOf("\n")) >= 0) {
      const line = pending.slice(0, newline).trim();
      pending = pending.slice(newline + 1);
      if (!line) continue;
      try {
        onRecord(parseJournalRecord(line));
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
        return;
      }
    }
    if (pending.length > 16 * 1024 * 1024) fail("Beads journal record exceeds 16 MiB");
  });
  child.on("error", (error) => fail(error.message));
  child.on("close", (code) => fail(stderr || `Beads journal follower exited (${code})`));
  return () => {
    stopped = true;
    child.stdin.destroy();
    child.kill();
  };
}

/** Config switches are not journal records; invalidate when writers turn it off. */
export function watchJournalConfig(repoPath: string, onChange: () => void): () => void {
  const watcher = watch(join(repoPath, ".beads"), { persistent: false }, (_event, filename) => {
    if (!filename || filename.toString() === "config.yaml") onChange();
  });
  watcher.on("error", onChange);
  return () => watcher.close();
}
