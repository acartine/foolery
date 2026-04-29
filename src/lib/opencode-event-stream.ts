export type OpenCodeEventHandler = (value: unknown) => void;

function parseSseBlock(
  block: string,
  onData: OpenCodeEventHandler,
): void {
  const payload = block
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n")
    .trim();
  if (!payload) return;
  try {
    onData(JSON.parse(payload) as unknown);
  } catch {
    // Ignore malformed SSE payloads; OpenCode will keep streaming.
  }
}

function drainSseBuffer(
  buffer: string,
  onData: OpenCodeEventHandler,
): string {
  let remaining = buffer.replace(/\r\n/g, "\n");
  let separator = remaining.indexOf("\n\n");
  while (separator >= 0) {
    parseSseBlock(
      remaining.slice(0, separator),
      onData,
    );
    remaining = remaining.slice(separator + 2);
    separator = remaining.indexOf("\n\n");
  }
  return remaining;
}

async function readOpenCodeEventStream(
  baseUrl: string,
  controller: AbortController,
  onData: OpenCodeEventHandler,
  onError: (message: string) => void,
): Promise<void> {
  let buffer = "";
  try {
    const resp = await fetch(`${baseUrl}/event`, {
      headers: { Accept: "text/event-stream" },
      signal: controller.signal,
    });
    if (!resp.ok || !resp.body) {
      onError("OpenCode event stream failed to open.");
      return;
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    while (!controller.signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer = drainSseBuffer(
        buffer + decoder.decode(value, { stream: true }),
        onData,
      );
    }
    buffer = drainSseBuffer(
      buffer + decoder.decode(),
      onData,
    );
  } catch (err) {
    if (controller.signal.aborted) return;
    const msg = err instanceof Error
      ? err.message
      : "Unknown error";
    onError(`OpenCode event stream error: ${msg}`);
  }
}

export function startOpenCodeEventStream(
  baseUrl: string,
  onData: OpenCodeEventHandler,
  onError: (message: string) => void,
): AbortController {
  const controller = new AbortController();
  void readOpenCodeEventStream(
    baseUrl,
    controller,
    onData,
    onError,
  );
  return controller;
}
