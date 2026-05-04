import { describe, expect, it, vi } from "vitest";

const mockListOptions = vi.fn();

vi.mock("@/lib/stale-beat-grooming-agent", () => ({
  listStaleBeatGroomingAgentOptions: () => mockListOptions(),
}));

import { GET } from "@/app/api/beats/stale-grooming/options/route";

describe("GET /api/beats/stale-grooming/options", () => {
  it("returns all configured model choices and the dispatch default", async () => {
    mockListOptions.mockResolvedValue({
      agents: [
        { id: "codex", label: "Codex", command: "codex" },
        { id: "hermes", label: "Hermes", command: "hermes" },
      ],
      defaultAgentId: "codex",
    });

    const response = await GET();
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({
      ok: true,
      data: {
        agents: [
          { id: "codex", label: "Codex", command: "codex" },
          { id: "hermes", label: "Hermes", command: "hermes" },
        ],
        defaultAgentId: "codex",
      },
    });
  });
});
