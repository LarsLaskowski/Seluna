/** Largest request body, in bytes, a route reads: 1 MiB. */
export const MAX_BODY_BYTES = 1_048_576;

/** Outcome of reading a request body within a byte limit. */
export type ReadBodyResult =
  { readonly kind: "ok"; readonly body: Uint8Array } | { readonly kind: "too-large" } | { readonly kind: "unreadable" };

const DECIMAL_DIGITS = /^\d+$/;

/** A `Content-Length` value as a byte count when it is a plain decimal number, otherwise `undefined`. */
export function parseContentLength(value: string | null): number | undefined {
  if (value === null || !DECIMAL_DIGITS.test(value)) {
    return undefined;
  }
  return Number(value);
}

/**
 * Reads the body of a request or response, rejecting a `Content-Length` above `maxBytes` before reading and a body whose
 * counted bytes exceed `maxBytes` while reading.
 *
 * The header is only an early answer: it is never used as an allocation size or as a point to stop reading.
 * Memory: while reading, at most `maxBytes` plus one chunk is held; on the `ok` path the chunks are still held
 * while they are copied into the combined array, so the peak is about twice `maxBytes`.
 */
export async function readBodyWithLimit(message: Request | Response, maxBytes: number): Promise<ReadBodyResult> {
  const declared = parseContentLength(message.headers.get("content-length"));
  if (declared !== undefined && declared > maxBytes) {
    return { kind: "too-large" };
  }
  if (message.body === null) {
    return { kind: "ok", body: new Uint8Array(0) };
  }

  const reader = message.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) {
        break;
      }
      // The runtime types a chunk as `any`; a body stream yields bytes, anything else is not a readable body.
      const value: unknown = result.value;
      if (!(value instanceof Uint8Array)) {
        await reader.cancel().catch(() => undefined);
        return { kind: "unreadable" };
      }
      total += value.byteLength;
      if (total > maxBytes) {
        // A failing cancel changes nothing about the answer; handle it so it is not an unhandled rejection.
        await reader.cancel().catch(() => undefined);
        return { kind: "too-large" };
      }
      chunks.push(value);
    }
  } catch {
    return { kind: "unreadable" };
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { kind: "ok", body };
}

/** The parsed JSON of a body of at most `maxBytes` bytes (counted before decoding) that is UTF-8 JSON, else `undefined`. Never throws. */
export async function readJsonWithLimit(_message: Request | Response, _maxBytes: number): Promise<unknown> {
  throw new Error("Not implemented");
}
