import { describe, expect, it } from "vitest";
import { consumeNdjsonStream } from "@/lib/ndjson-stream";

function makeStream(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(line));
      }
      controller.close();
    },
  });
}

describe("consumeNdjsonStream", () => {
  it("parses complete lines", async () => {
    const items: unknown[] = [];
    const body = makeStream([
      '{"a":1}\n',
      '{"a":2}\n',
    ]);

    await consumeNdjsonStream(body, {
      onLine: (v) => items.push(v),
    });

    expect(items).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("handles chunked data across line boundaries", async () => {
    const items: unknown[] = [];
    // Line split across two chunks
    const body = makeStream([
      '{"a":',
      '1}\n{"a":2}\n',
    ]);

    await consumeNdjsonStream(body, {
      onLine: (v) => items.push(v),
    });

    expect(items).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("flushes partial trailing line", async () => {
    const items: unknown[] = [];
    // No trailing newline
    const body = makeStream(['{"a":1}']);

    await consumeNdjsonStream(body, {
      onLine: (v) => items.push(v),
    });

    expect(items).toEqual([{ a: 1 }]);
  });

  it("skips empty lines", async () => {
    const items: unknown[] = [];
    const body = makeStream([
      '{"a":1}\n\n\n{"a":2}\n',
    ]);

    await consumeNdjsonStream(body, {
      onLine: (v) => items.push(v),
    });

    expect(items).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("respects abort signal", async () => {
    const items: unknown[] = [];
    const controller = new AbortController();
    controller.abort();

    const body = makeStream(['{"a":1}\n']);

    await consumeNdjsonStream(body, {
      onLine: (v) => items.push(v),
      signal: controller.signal,
    });

    // Should not parse anything when already aborted
    expect(items).toEqual([]);
  });
});
