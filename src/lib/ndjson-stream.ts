/**
 * Client-side NDJSON stream consumer.
 *
 * Reads a `ReadableStream<Uint8Array>` line-by-line, parses each
 * line as JSON, and invokes a callback per parsed object.
 */

export interface NdjsonReaderOptions<T> {
  /** Called for each parsed NDJSON line. */
  onLine: (value: T) => void;
  /** Optional AbortSignal for cancellation. */
  signal?: AbortSignal;
}

/**
 * Consume an NDJSON response body, calling `onLine` for each
 * parsed JSON object.  Resolves when the stream is fully consumed.
 */
export async function consumeNdjsonStream<T>(
  body: ReadableStream<Uint8Array>,
  options: NdjsonReaderOptions<T>,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      if (options.signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (line.length > 0) {
          options.onLine(JSON.parse(line) as T);
        }
        newlineIndex = buffer.indexOf("\n");
      }
    }

    // Flush any remaining partial line.
    const remaining = buffer.trim();
    if (remaining.length > 0) {
      options.onLine(JSON.parse(remaining) as T);
    }
  } finally {
    reader.releaseLock();
  }
}
