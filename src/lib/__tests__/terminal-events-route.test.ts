import { EventEmitter } from "node:events";
import { NextRequest } from "next/server";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TerminalEvent, TerminalSession } from "../types";

const getSessionMock = vi.fn();

vi.mock("@/lib/terminal-manager", () => ({
  getSession: (id: string) => getSessionMock(id),
}));

import { GET } from "@/app/api/terminal/events/route";

beforeEach(() => {
  getSessionMock.mockReset();
});

function makeRequest(sessionIds: string): NextRequest {
  return new NextRequest(
    `http://localhost/api/terminal/events?sessionIds=${sessionIds}`,
  );
}

function makeSession(id: string): TerminalSession {
  return {
    id,
    beatId: "beat-1",
    beatTitle: "Beat",
    status: "running",
    startedAt: "2026-05-25T00:00:00.000Z",
  };
}

async function readSseJson(res: Response): Promise<unknown> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) throw new Error("SSE stream ended before data frame");
      const text = decoder.decode(chunk.value);
      const dataLine = text
        .split("\n")
        .find((line) => line.startsWith("data: "));
      if (dataLine) return JSON.parse(dataLine.replace(/^data: /, ""));
    }
  } finally {
    await reader.cancel();
  }
}

describe("GET /api/terminal/events", () => {
  it("requires sessionIds", async () => {
    const res = await GET(makeRequest(""));
    expect(res.status).toBe(400);
  });

  it("replays buffered events with session ids", async () => {
    const event: TerminalEvent = {
      type: "stdout",
      data: "hello",
      timestamp: 1,
    };
    getSessionMock.mockReturnValue({
      session: makeSession("sess-a"),
      emitter: new EventEmitter(),
      buffer: [event],
    });

    const res = await GET(makeRequest("sess-a"));

    expect(res.status).toBe(200);
    await expect(readSseJson(res)).resolves.toEqual({
      sessionId: "sess-a",
      event,
    });
  });
});
