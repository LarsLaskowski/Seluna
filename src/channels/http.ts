/** The function that sends a request; `fetch` in production, a double in tests. */
export type ChannelFetch = (request: Request) => Promise<Response>;

/** Time after which a channel request is aborted. */
export const CHANNEL_TIMEOUT_MS = 10_000;
/** Largest channel answer that is read, in bytes. */
export const MAX_CHANNEL_RESPONSE_BYTES = 1_048_576;
/** Longest wait, in seconds, after a rate-limit answer before the one retry. */
export const MAX_RETRY_WAIT_SECONDS = 5;

/** What a channel request came to: the answer with its status and decoded body, or a failure without one. */
export type HttpAnswer =
  | { readonly kind: "answered"; readonly status: number; readonly ok: boolean; readonly body: unknown }
  | { readonly kind: "failed" };

/** Posts `payload` as JSON to `url`. Never rejects. */
export function postJson(url: string, payload: object, fetcher: ChannelFetch): Promise<HttpAnswer> {
  throw new Error("Not implemented");
}

/** Posts like `postJson`; after a 429 waits the seconds `retryAfterSeconds` reads (1 to `MAX_RETRY_WAIT_SECONDS`) and posts once more. Never rejects. */
export function postJsonWithRetry(
  url: string,
  payload: object,
  fetcher: ChannelFetch,
  sleep: (milliseconds: number) => Promise<void>,
  retryAfterSeconds: (body: unknown) => number | undefined,
): Promise<HttpAnswer> {
  throw new Error("Not implemented");
}
