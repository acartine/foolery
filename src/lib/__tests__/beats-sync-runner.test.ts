import { describe, expect, it, vi } from "vitest";
import { runRepoSync } from "@/lib/beats-sync-runner";
import type { RegisteredRepo } from "@/lib/registry";

function repo(memoryManagerType: "knots" | "beads"): RegisteredRepo {
  return {
    path: "/repo",
    name: "repo",
    addedAt: "2026-01-01T00:00:00.000Z",
    memoryManagerType,
  };
}

describe("beats sync runner", () => {
  it("runs kno sync for Knots repos", async () => {
    const execFile = vi.fn().mockResolvedValue({});
    const result = await runRepoSync(repo("knots"), { execFile });

    expect(result).toEqual({ ok: true });
    expect(execFile).toHaveBeenCalledWith("kno", ["sync"], { cwd: "/repo" });
  });

  it("runs bd sync --no-daemon for Beads repos", async () => {
    const execFile = vi.fn().mockResolvedValue({});
    const result = await runRepoSync(repo("beads"), { execFile });

    expect(result).toEqual({ ok: true });
    expect(execFile).toHaveBeenCalledWith(
      "bd",
      ["sync", "--no-daemon"],
      { cwd: "/repo" },
    );
  });
});
