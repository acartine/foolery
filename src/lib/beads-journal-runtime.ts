import type { Beat } from "./types";
import type { BeatListFilters } from "./backend-port";
import { filterJournalBeats } from "./beads-journal-filters";
import { normalizeBeat } from "./bd-queries";
import { BeadsJournalMirror, parseJournalRecord } from "./beads-journal";
import {
  followJournal, readJournalHead, runJournalCommand, supportsJournalStdinLifetime,
  watchJournalConfig,
} from "./beads-journal-process";

export type JournalNotice = {
  type: "ready" | "change" | "polling" | "error";
  repoPath: string;
  message?: string;
};
type Listener = (notice: JournalNotice) => void;
interface Entry {
  mirror: BeadsJournalMirror;
  listeners: Set<Listener>;
  ready: boolean;
  stop: () => void;
  timer?: ReturnType<typeof setTimeout>;
  generation: number;
  stdinLifetime?: boolean;
  stopConfigWatch?: () => void;
}
const entries = new Map<string, Entry>();
const RECONCILE_MS = 5 * 60_000;

function notify(entry: Entry, notice: JournalNotice): void {
  for (const listener of entry.listeners) listener(notice);
}

function scheduleRebuild(repoPath: string, entry: Entry, delay: number): void {
  clearTimeout(entry.timer);
  entry.timer = setTimeout(() => {
    void rebuild(repoPath, entry);
  }, delay);
  entry.timer.unref();
}

function attachConfigWatch(repoPath: string, entry: Entry): void {
  if (entry.stopConfigWatch) return;
  entry.stopConfigWatch = watchJournalConfig(repoPath, () => {
    if (entries.get(repoPath) !== entry) return;
    entry.ready = false;
    notify(entry, { type: "polling", repoPath });
    scheduleRebuild(repoPath, entry, 100);
  });
}

async function rebuild(repoPath: string, entry: Entry): Promise<void> {
  const generation = ++entry.generation;
  entry.ready = false;
  notify(entry, { type: "polling", repoPath });
  entry.stop();
  entry.stop = () => {};
  const current = () => entries.get(repoPath) === entry && entry.generation === generation;
  try {
    const sequence = await readJournalHead(repoPath);
    if (!current()) return;
    if (sequence === null) {
      notify(entry, { type: "polling", repoPath,
        message: "Beads journal unavailable; enable with bd config set events-journal true." });
      scheduleRebuild(repoPath, entry, 30_000);
      return;
    }
    attachConfigWatch(repoPath, entry);
    entry.stdinLifetime ??= await supportsJournalStdinLifetime(repoPath);
    if (!current()) return;
    const snapshot = await runJournalCommand([
      "list", "--json", "--limit", "0", "--all",
    ], repoPath);
    if (!current()) return;
    const raw = JSON.parse(snapshot) as Record<string, unknown>[];
    entry.mirror.baseline(raw.map(normalizeBeat), sequence);
    // Catch up after the snapshot before exposing it. Events committed during
    // the snapshot are replayed, so snapshot/follow startup cannot lose a write.
    const catchup = await runJournalCommand([
      "events", "tail", "--since", String(sequence), "--json",
    ], repoPath);
    if (!current()) return;
    for (const line of catchup.split("\n")) {
      if (line.trim()) entry.mirror.apply(parseJournalRecord(line));
    }
    entry.stop = followJournal(repoPath, entry.mirror.sequence, (record) => {
      if (!current()) return;
      if (entry.mirror.apply(record)) notify(entry, { type: "change", repoPath });
    }, (message) => {
      if (!current()) return;
      entry.ready = false;
      console.error(`\u001b[31mFOOLERY BEADS JOURNAL FAILURE: ${repoPath}: ${message}\u001b[0m`);
      notify(entry, { type: "error", repoPath, message });
      scheduleRebuild(repoPath, entry, 3_000);
    }, entry.stdinLifetime);
    entry.ready = true;
    notify(entry, { type: "ready", repoPath });
    // Dolt pulls and direct library writes are not journaled. Periodically
    // reconcile current state instead of pretending the journal covers them.
    scheduleRebuild(repoPath, entry, RECONCILE_MS);
  } catch (error) {
    if (!current()) return;
    entry.ready = false;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\u001b[31mFOOLERY BEADS JOURNAL FAILURE: ${repoPath}: ${message}\u001b[0m`);
    notify(entry, { type: "error", repoPath, message });
    scheduleRebuild(repoPath, entry, 3_000);
  }
}

export function subscribeBeadsJournal(repoPath: string, listener: Listener): () => void {
  let entry = entries.get(repoPath);
  if (!entry) {
    entry = { mirror: new BeadsJournalMirror(normalizeBeat), listeners: new Set(),
      ready: false, stop: () => {}, generation: 0 };
    entries.set(repoPath, entry);
    entry.listeners.add(listener);
    void rebuild(repoPath, entry);
  } else {
    entry.listeners.add(listener);
    if (entry.ready) listener({ type: "ready", repoPath });
  }
  const subscribed = entry;
  return () => {
    subscribed.listeners.delete(listener);
    if (subscribed.listeners.size === 0) {
      entries.delete(repoPath);
      subscribed.generation++;
      subscribed.stop();
      subscribed.stopConfigWatch?.();
      clearTimeout(subscribed.timer);
    }
  };
}

export function cachedJournalBeats(
  repoPath: string | undefined,
  filters?: BeatListFilters,
): Beat[] | undefined {
  if (!repoPath) return undefined;
  const entry = entries.get(repoPath);
  return entry?.ready ? filterJournalBeats(entry.mirror.snapshot(), filters) : undefined;
}

/** A known sync invalidates the clone-local journal immediately. */
export function refreshBeadsJournal(repoPath: string): void {
  const entry = entries.get(repoPath);
  if (entry) {
    clearTimeout(entry.timer);
    void rebuild(repoPath, entry);
  }
}
