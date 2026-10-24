import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BeadsJournalRecord } from "../beads-journal";
const transport = vi.hoisted(() => ({
  head: vi.fn(), run: vi.fn(), follow: vi.fn(), watch: vi.fn(),
}));
vi.mock("../beads-journal-process", () => ({
  readJournalHead: transport.head,
  runJournalCommand: transport.run,
  followJournal: transport.follow,
  supportsJournalStdinLifetime: async () => true,
  watchJournalConfig: transport.watch,
}));
import { cachedJournalBeats, subscribeBeadsJournal } from "../beads-journal-runtime";

const issue = { id: "a", title: "Initial", status: "open", priority: 2, labels: [],
  created_at: "2026-01-01", updated_at: "2026-01-01" };
let record: (value: BeadsJournalRecord) => void;
let fail: (message: string) => void;
const stop = vi.fn();
const cleanup: Array<() => void> = [];
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  transport.head.mockResolvedValue(5);
  transport.watch.mockReturnValue(() => {});
  transport.run.mockImplementation((args: string[]) => Promise.resolve(
    args[0] === "list" ? JSON.stringify([issue]) : "",
  ));
  transport.follow.mockImplementation((_path, _sequence, onRecord, onFailure) => {
    record = onRecord;
    fail = onFailure;
    return stop;
  });
});
afterEach(() => {
  cleanup.splice(0).forEach((unsubscribe) => unsubscribe());
  vi.useRealTimers();
});

describe("shared Beads journal mirror", () => {
  it("baselines once, catches startup writes, and follows from the processed checkpoint", async () => {
    transport.run.mockResolvedValueOnce(JSON.stringify([issue])).mockResolvedValueOnce(
      JSON.stringify({ seq: 6, op: "update", issue_id: "a", issue: { ...issue, title: "Race" } }),
    );
    const notices = vi.fn();
    cleanup.push(subscribeBeadsJournal("/repo", notices));
    await settle();
    expect(cachedJournalBeats("/repo")).toMatchObject([{ title: "Race" }]);
    expect(transport.follow.mock.calls[0].slice(0, 2)).toEqual(["/repo", 6]);
    expect(notices).toHaveBeenCalledWith({ type: "ready", repoPath: "/repo" });
    record({ seq: 7, op: "update", issue_id: "a", issue: { ...issue, priority: 1 } });
    expect(cachedJournalBeats("/repo", { priority: 1 })).toHaveLength(1);
    expect(cachedJournalBeats("/repo", { priority: 2 })).toEqual([]);
    expect(transport.run).toHaveBeenCalledTimes(2);
  });

  it("shares a follower between subscribers and stops when the last disconnects", async () => {
    const first = subscribeBeadsJournal("/repo", vi.fn());
    const second = subscribeBeadsJournal("/repo", vi.fn());
    await settle();
    expect(transport.follow).toHaveBeenCalledTimes(1);
    first();
    expect(stop).not.toHaveBeenCalled();
    second();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(cachedJournalBeats("/repo")).toBeUndefined();
  });

  it("keeps old/disabled journals on the CLI path and retries capability later", async () => {
    transport.head.mockResolvedValueOnce(null);
    const notices = vi.fn();
    cleanup.push(subscribeBeadsJournal("/repo", notices));
    await settle();
    expect(notices.mock.calls[0][0].type).toBe("polling");
    expect(cachedJournalBeats("/repo")).toBeUndefined();
    expect(transport.run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(cachedJournalBeats("/repo")).toHaveLength(1);
  });

  it("drops a failed mirror and re-baselines on truncation or follower exit", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    cleanup.push(subscribeBeadsJournal("/repo", vi.fn()));
    await settle();
    fail("events_journal_truncated");
    expect(cachedJournalBeats("/repo")).toBeUndefined();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(transport.head).toHaveBeenCalledTimes(2);
    expect(cachedJournalBeats("/repo")).toHaveLength(1);
    vi.restoreAllMocks();
  });

  it("reconciles unjournaled sync changes and never shares checkpoints across repos", async () => {
    cleanup.push(subscribeBeadsJournal("/a", vi.fn()));
    cleanup.push(subscribeBeadsJournal("/b", vi.fn()));
    await settle();
    expect(transport.head).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(transport.head).toHaveBeenCalledTimes(4);
  });

  it("does not start a follower if its client disconnects during initialization", async () => {
    const unsubscribe = subscribeBeadsJournal("/repo", vi.fn());
    unsubscribe();
    await settle();
    expect(transport.follow).not.toHaveBeenCalled();
  });
});

it("restores polling if workspace config disables an already running journal", async () => {
  const notices = vi.fn();
  cleanup.push(subscribeBeadsJournal("/repo", notices));
  await settle();
  expect(cachedJournalBeats("/repo")).toHaveLength(1);
  transport.head.mockResolvedValue(null);
  transport.watch.mock.calls[0][1]();
  expect(cachedJournalBeats("/repo")).toBeUndefined();
  await vi.advanceTimersByTimeAsync(100);
  expect(notices.mock.calls.at(-1)?.[0].type).toBe("polling");
  expect(stop).toHaveBeenCalled();
});
