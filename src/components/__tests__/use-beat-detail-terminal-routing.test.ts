import { beforeEach, describe, expect, it, vi } from "vitest";

const mockMarkTerminalOrThrow = vi.fn();
const mockUpdateBeatOrThrow = vi.fn();

vi.mock("@/lib/update-beat-mutation", () => ({
  markTerminalOrThrow: (...args: unknown[]) =>
    mockMarkTerminalOrThrow(...args),
  updateBeatOrThrow: (...args: unknown[]) =>
    mockUpdateBeatOrThrow(...args),
}));

import { dispatchBeatDetailUpdate } from "../use-beat-detail-data";
import type { Beat } from "@/lib/types";

beforeEach(() => {
  vi.clearAllMocks();
  mockMarkTerminalOrThrow.mockResolvedValue(undefined);
  mockUpdateBeatOrThrow.mockResolvedValue(undefined);
});

function makeBeat(id: string, state: string): Beat {
  return {
    id,
    title: `Beat ${id}`,
    type: "work",
    state,
  } as Beat;
}

describe("dispatchBeatDetailUpdate", () => {
  const beats = [makeBeat("a", "implementation")];

  it("routes shipped corrections through markTerminalOrThrow", async () => {
    await dispatchBeatDetailUpdate(
      beats,
      "a",
      { state: "shipped" },
      "/tmp/repo",
    );

    expect(mockMarkTerminalOrThrow).toHaveBeenCalledWith(
      beats,
      "a",
      "shipped",
      undefined,
      "/tmp/repo",
    );
    expect(mockUpdateBeatOrThrow).not.toHaveBeenCalled();
  });

  it("routes non-terminal updates through updateBeatOrThrow", async () => {
    await dispatchBeatDetailUpdate(
      beats,
      "a",
      { state: "ready_for_shipment" },
      "/tmp/repo",
    );

    expect(mockUpdateBeatOrThrow).toHaveBeenCalledWith(
      beats,
      "a",
      { state: "ready_for_shipment" },
      "/tmp/repo",
    );
    expect(mockMarkTerminalOrThrow).not.toHaveBeenCalled();
  });
});
