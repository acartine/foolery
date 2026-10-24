import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ execFile: vi.fn(), spawn: vi.fn() }));
vi.mock("node:child_process", () => mocks);
import {
  followJournal, journalTruncationHead, journalUnavailable, readJournalHead, journalCommandEnv,
} from "../beads-journal-process";

function output(stdout: string, stderr = "", error: Error | null = null) {
  mocks.execFile.mockImplementation((_bin, _args, _options, callback) => {
    callback(error, stdout, stderr);
  });
}
beforeEach(() => vi.clearAllMocks());

describe("Beads journal CLI transport", () => {
  it("removes legacy/envelope mode while preserving the supplied environment", () => {
    expect(journalCommandEnv({
      NODE_ENV: "test", BD_JSON_ENVELOPE: "1", BD_NO_DB: "1", PATH: "/bin",
    })).toEqual({ NODE_ENV: "test", PATH: "/bin" });
  });
  it("distinguishes an empty enabled journal from a disabled successful read", async () => {
    output("");
    expect(await readJournalHead("/repo")).toBe(0);
    output("", "note: the events journal is disabled for this workspace");
    expect(await readJournalHead("/repo")).toBeNull();
  });

  it("detects old bd and rejects unrelated failures", async () => {
    output("", 'Error: unknown command "events" for "bd"', new Error("exit 1"));
    expect(await readJournalHead("/repo")).toBeNull();
    output("", "database is locked", new Error("exit 1"));
    await expect(readJournalHead("/repo")).rejects.toThrow("database is locked");
    expect(journalUnavailable("permission denied")).toBe(false);
  });

  it("recovers a pruned journal head from the documented JSON error", async () => {
    output(JSON.stringify({ code: "events_journal_truncated", floor: 40, head: 100 }),
      "", new Error("exit 1"));
    expect(await readJournalHead("/repo")).toBe(100);
    expect(journalTruncationHead("not JSON")).toBeUndefined();
  });

  it("finds the highest checkpoint instead of assuming contiguous sequence values", async () => {
    const raw = [3, 11].map((seq) => JSON.stringify({ seq, op: "delete",
      issue_id: "gone", issue: null })).join("\n");
    output(raw);
    expect(await readJournalHead("/repo")).toBe(11);
  });

  it("decodes chunked JSONL, reports malformed records, and cleans up the follower", () => {
    const stdout = Object.assign(new EventEmitter(), { setEncoding: vi.fn() });
    const stderr = Object.assign(new EventEmitter(), { setEncoding: vi.fn() });
    const child = Object.assign(new EventEmitter(), { stdout, stderr,
      stdin: { destroy: vi.fn() }, kill: vi.fn() });
    mocks.spawn.mockReturnValue(child);
    const record = vi.fn();
    const failure = vi.fn();
    const stop = followJournal("/repo", 41, record, failure, true);
    expect(mocks.spawn.mock.calls[0][1]).toContain("--exit-on-stdin-eof");
    expect(mocks.spawn.mock.calls[0][1]).toContain("41");
    const line = JSON.stringify({ seq: 42, op: "delete", issue_id: "a", issue: null });
    stdout.emit("data", line.slice(0, 20));
    expect(record).not.toHaveBeenCalled();
    stdout.emit("data", line.slice(20) + "\n");
    expect(record).toHaveBeenCalledWith({ seq: 42, op: "delete", issue_id: "a", issue: null });
    stdout.emit("data", '{"code":"events_journal_truncated"}\n');
    expect(failure).toHaveBeenCalledTimes(1);
    expect(child.kill).toHaveBeenCalled();
    stop();
    expect(child.stdin.destroy).toHaveBeenCalled();
    child.emit("close", 1);
    expect(failure).toHaveBeenCalledTimes(1);
  });
});

it("disables a live stream when stderr announces a disabled journal", () => {
  const stdout = Object.assign(new EventEmitter(), { setEncoding: vi.fn() });
  const stderr = Object.assign(new EventEmitter(), { setEncoding: vi.fn() });
  const child = Object.assign(new EventEmitter(), { stdout, stderr,
    stdin: { destroy: vi.fn() }, kill: vi.fn() });
  mocks.spawn.mockReturnValue(child);
  const failure = vi.fn();
  followJournal("/repo", 0, vi.fn(), failure);
  stderr.emit("data", "note: the events journal is disabled for this workspace");
  expect(failure).toHaveBeenCalledTimes(1);
  expect(child.kill).toHaveBeenCalled();
});
