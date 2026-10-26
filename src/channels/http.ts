import { readBodyWithLimit } from "../body";

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

/** Posts `payload` as JSON to `url`. Never rejects. The body of a non-2xx answer is read only for a 429. */
export async function postJson(url: string, payload: object, fetcher: ChannelFetch): Promise<HttpAnswer> {
  try {
    const request = new Request(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(CHANNEL_TIMEOUT_MS),
    });
    const response = await fetcher(request);
    if (!response.ok && response.status !== 429) {
      await response.body?.cancel().catch(() => undefined);
      return { kind: "answered", status: response.status, ok: false, body: undefined };
    }
    // Only the retry hint of a 429 is read of a non-2xx answer; an answer that is too large is a failure.
    const read = await readBodyWithLimit(response, MAX_CHANNEL_RESPONSE_BYTES);
    if (read.kind !== "ok") {
      return { kind: "failed" };
    }
    const body = jsonOf(read.body);
    // A 2xx answer that is not JSON is a failure; the unreadable body of a 429 only leaves out the retry hint.
    return body === undefined && response.ok
      ? { kind: "failed" }
      : { kind: "answered", status: response.status, ok: response.ok, body };
  } catch {
    // Network errors, aborts and unreadable answers carry nothing the owner can use; the cause is dropped.
    return { kind: "failed" };
  }
}

/** Posts like `postJson`; after a 429 waits the seconds `retryAfterSeconds` reads (1 to `MAX_RETRY_WAIT_SECONDS`) and posts once more. Never rejects. */
export async function postJsonWithRetry(
  url: string,
  payload: object,
  fetcher: ChannelFetch,
  sleep: (milliseconds: number) => Promise<void>,
  retryAfterSeconds: (body: unknown) => number | undefined,
): Promise<HttpAnswer> {
  const answer = await postJson(url, payload, fetcher);
  if (answer.kind !== "answered" || answer.status !== 429) {
    return answer;
  }
  const seconds = retryAfterSeconds(answer.body);
  if (seconds === undefined || !(seconds >= 1 && seconds <= MAX_RETRY_WAIT_SECONDS)) {
    return answer;
  }
  try {
    await sleep(seconds * 1000);
  } catch {
    return { kind: "failed" };
  }
  return postJson(url, payload, fetcher);
}

/** The parsed JSON of UTF-8 `bytes`, else `undefined`. Never throws. */
function jsonOf(bytes: Uint8Array): unknown {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes));
    return parsed;
  } catch {
    return undefined;
  }
}
