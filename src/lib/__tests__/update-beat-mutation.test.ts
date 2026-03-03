import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Beat } from "@/lib/types";
import { updateBeatOrThrow } from "@/lib/update-beat-mutation";
import { updateBead } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  updateBead: vi.fn(),
}));

function makeBeat(overrides: Partial<Beat> = {}): Beat {
  return {
    id: "foolery-1",
    title: "Test beat",
    type: "work",
    state: "implementation",
    priority: 2,
    labels: [],
    created: "2026-01-01T00:00:00.000Z",
    updated: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("updateBeatOrThrow", () => {
  const updateBeadMock = vi.mocked(updateBead);

  beforeEach(() => {
    updateBeadMock.mockReset();
  });

  it("passes the beat repo path when available", async () => {
    const beat = { ...makeBeat(), _repoPath: "/tmp/repo-a" } as Beat;
    updateBeadMock.mockResolvedValue({ ok: true });

    await expect(updateBeatOrThrow([beat], beat.id, { state: "abandoned" })).resolves.toBeUndefined();
    expect(updateBeadMock).toHaveBeenCalledWith(
      beat.id,
      { state: "abandoned" },
      "/tmp/repo-a",
    );
  });

  it("prefers the explicit repo path when one is provided", async () => {
    const beatA = { ...makeBeat(), _repoPath: "/tmp/repo-a" } as Beat;
    const beatB = { ...makeBeat(), _repoPath: "/tmp/repo-b" } as Beat;
    updateBeadMock.mockResolvedValue({ ok: true });

    await expect(
      updateBeatOrThrow([beatA, beatB], beatA.id, { state: "abandoned" }, "/tmp/repo-b"),
    ).resolves.toBeUndefined();
    expect(updateBeadMock).toHaveBeenCalledWith(
      beatA.id,
      { state: "abandoned" },
      "/tmp/repo-b",
    );
  });

  it("throws backend error messages so callers can surface them", async () => {
    const beat = { ...makeBeat(), _repoPath: "/tmp/repo-a" } as Beat;
    updateBeadMock.mockResolvedValue({ ok: false, error: "transition rejected" });

    await expect(updateBeatOrThrow([beat], beat.id, { state: "abandoned" })).rejects.toThrow(
      "transition rejected",
    );
  });

  it("uses a fallback error message when backend returns none", async () => {
    const beat = makeBeat();
    updateBeadMock.mockResolvedValue({ ok: false });

    await expect(updateBeatOrThrow([beat], beat.id, { state: "abandoned" })).rejects.toThrow(
      "Failed to update beat",
    );
  });
});
