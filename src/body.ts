/** Largest request body, in bytes, a route reads: 1 MiB. */
export const MAX_BODY_BYTES = 1_048_576;

/** Outcome of reading a request body within a byte limit. */
export type ReadBodyResult =
  { readonly kind: "ok"; readonly body: Uint8Array } | { readonly kind: "too-large" } | { readonly kind: "unreadable" };

/** A `Content-Length` value as a byte count when it is a plain decimal number, otherwise `undefined`. */
export function parseContentLength(value: string | null): number | undefined {
  throw new Error("Not implemented");
}

/**
 * Reads the request body, rejecting a `Content-Length` above `maxBytes` before reading and a body whose
 * counted bytes exceed `maxBytes` while reading.
 */
export function readBodyWithLimit(request: Request, maxBytes: number): Promise<ReadBodyResult> {
  throw new Error("Not implemented");
}
