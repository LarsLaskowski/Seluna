import { describe, expect, it, onTestFinished, vi } from "vitest";
import { CHANNEL_TIMEOUT_MS, MAX_CHANNEL_RESPONSE_BYTES, postJson, postJsonWithRetry } from "./http";
import type { ChannelFetch } from "./http";

const URL_WITH_CREDENTIAL = "https://channel.example/bot123456789:AAH-throwaway_token0123456789abcdefghij/send";
const PAYLOAD = { text: "<b>T</b> · o/r #7", flag: true };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** A fetch double that answers the n-th request with the n-th response (the last is repeated) and records the requests. */
function answering(...responses: readonly Response[]): {
  readonly fetch: ReturnType<typeof vi.fn<ChannelFetch>>;
  readonly bodies: string[];
} {
  const bodies: string[] = [];
  let count = 0;
  const fetcher = vi.fn<ChannelFetch>(async (request) => {
    bodies.push(await request.clone().text());
    const response = responses[Math.min(count, responses.length - 1)];
    count += 1;
    if (response === undefined) {
      throw new TypeError("No answer given");
    }
    return response.clone();
  });
  return { fetch: fetcher, bodies };
}

/** A retry-after reader for the tests: the `wait` field of the body, as the channel's own rule would read it. */
function waitOf(body: unknown): number | undefined {
  if (typeof body === "object" && body !== null && "wait" in body && typeof body.wait === "number") {
    return body.wait;
  }
  return undefined;
}

function sleepSpy(): ReturnType<typeof vi.fn<(milliseconds: number) => Promise<void>>> {
  return vi.fn<(milliseconds: number) => Promise<void>>(() => Promise.resolve());
}

describe("postJson", () => {
  it("postJson posts the payload as JSON to the URL and returns the status and the decoded body", async () => {
    const double = answering(jsonResponse(200, { ok: true }));

    const answer = await postJson("https://channel.example/send", PAYLOAD, double.fetch);

    expect(answer, "answer").toEqual({ kind: "answered", status: 200, ok: true, body: { ok: true } });
    const request = double.fetch.mock.calls[0]?.[0];
    expect(request?.url, "URL").toBe("https://channel.example/send");
    expect(request?.method, "HTTP method").toBe("POST");
    expect(request?.headers.get("content-type"), "Content-Type").toBe("application/json");
    expect(double.bodies, "request bodies").toEqual([JSON.stringify(PAYLOAD)]);
  });

  it("postJson returns failed without the cause when the fetch rejects with the URL in its message", async () => {
    const fetcher = vi.fn<ChannelFetch>(() =>
      Promise.reject(new TypeError(`connection to ${URL_WITH_CREDENTIAL} lost`)),
    );

    const answer = await postJson(URL_WITH_CREDENTIAL, PAYLOAD, fetcher);

    expect(answer, "answer").toEqual({ kind: "failed" });
    expect(JSON.stringify(answer), "answer text").not.toContain("AAH-throwaway");
  });

  it("postJson returns failed when the fetch throws synchronously", async () => {
    const fetcher: ChannelFetch = () => {
      throw new TypeError("no network");
    };

    const answer = await postJson("https://channel.example/send", PAYLOAD, fetcher);

    expect(answer, "answer").toEqual({ kind: "failed" });
  });

  it("postJson returns failed for a URL that cannot be parsed", async () => {
    const double = answering(jsonResponse(200, {}));

    const answer = await postJson("not a url", PAYLOAD, double.fetch);

    expect(answer, "answer").toEqual({ kind: "failed" });
    expect(double.fetch, "fetch calls").not.toHaveBeenCalled();
  });

  it("postJson aborts after CHANNEL_TIMEOUT_MS", async () => {
    const timeoutSignal = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeoutSignal.signal);
    onTestFinished(() => {
      timeout.mockRestore();
    });
    const hanging: ChannelFetch = (request) =>
      new Promise<Response>((_resolve, reject) => {
        request.signal.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted", "AbortError"));
        });
      });

    const pending = postJson("https://channel.example/send", PAYLOAD, hanging);
    timeoutSignal.abort();
    const answer = await pending;

    expect(timeout, "timeout signal requested").toHaveBeenCalledExactlyOnceWith(CHANNEL_TIMEOUT_MS);
    expect(answer, "answer").toEqual({ kind: "failed" });
  });

  it("postJson passes a signal that is not aborted before the timeout", async () => {
    const double = answering(jsonResponse(200, { ok: true }));

    await postJson("https://channel.example/send", PAYLOAD, double.fetch);

    expect(double.fetch.mock.calls[0]?.[0].signal.aborted, "signal aborted").toBe(false);
  });

  it("postJson rejects an answer above 1 MiB counted in bytes", async () => {
    const double = answering(new Response("x".repeat(MAX_CHANNEL_RESPONSE_BYTES + 1), { status: 200 }));

    const answer = await postJson("https://channel.example/send", PAYLOAD, double.fetch);

    expect(answer, "answer").toEqual({ kind: "failed" });
  });

  it("postJson counts bytes, not characters: 524289 two-byte characters are above 1 MiB", async () => {
    const double = answering(new Response(`"${"é".repeat(MAX_CHANNEL_RESPONSE_BYTES / 2)}"`, { status: 200 }));

    const answer = await postJson("https://channel.example/send", PAYLOAD, double.fetch);

    expect(answer, "answer").toEqual({ kind: "failed" });
  });

  it("postJson reads an answer of exactly 1 MiB", async () => {
    const padding = " ".repeat(MAX_CHANNEL_RESPONSE_BYTES - '{"ok":true}'.length);
    const double = answering(new Response(`{"ok":true}${padding}`, { status: 200 }));

    const answer = await postJson("https://channel.example/send", PAYLOAD, double.fetch);

    expect(answer, "answer").toEqual({ kind: "answered", status: 200, ok: true, body: { ok: true } });
  });

  it("postJson returns failed for a 2xx answer that is not JSON", async () => {
    const double = answering(new Response("not json", { status: 200 }));

    const answer = await postJson("https://channel.example/send", PAYLOAD, double.fetch);

    expect(answer, "answer").toEqual({ kind: "failed" });
  });

  it.each([400, 401, 404, 500])("postJson reads no body of a %i answer", async (status) => {
    const double = answering(jsonResponse(status, { ok: false, secret: "not read" }));

    const answer = await postJson("https://channel.example/send", PAYLOAD, double.fetch);

    expect(answer, "answer").toEqual({ kind: "answered", status, ok: false, body: undefined });
  });

  it("postJson reads the body of a 429 answer", async () => {
    const double = answering(jsonResponse(429, { wait: 3 }));

    const answer = await postJson("https://channel.example/send", PAYLOAD, double.fetch);

    expect(answer, "answer").toEqual({ kind: "answered", status: 429, ok: false, body: { wait: 3 } });
  });

  it("postJson reads no more than 1 MiB of a 429 answer", async () => {
    const double = answering(new Response("x".repeat(MAX_CHANNEL_RESPONSE_BYTES + 1), { status: 429 }));

    const answer = await postJson("https://channel.example/send", PAYLOAD, double.fetch);

    expect(answer, "answer").toEqual({ kind: "failed" });
  });
});

describe("postJsonWithRetry", () => {
  it.each([1, 2, 5])("postJsonWithRetry waits %i seconds once and sends again after a 429", async (seconds) => {
    const double = answering(jsonResponse(429, { wait: seconds }), jsonResponse(200, { ok: true }));
    const sleep = sleepSpy();

    const answer = await postJsonWithRetry("https://channel.example/send", PAYLOAD, double.fetch, sleep, waitOf);

    expect(answer, "answer").toEqual({ kind: "answered", status: 200, ok: true, body: { ok: true } });
    expect(sleep.mock.calls, "sleep calls").toEqual([[seconds * 1000]]);
    expect(double.bodies, "the same request is sent twice").toEqual([JSON.stringify(PAYLOAD), JSON.stringify(PAYLOAD)]);
  });

  it("postJsonWithRetry hands the decoded body of the 429 to the retry-after reader", async () => {
    const double = answering(jsonResponse(429, { wait: 1, other: "x" }), jsonResponse(200, {}));
    const reader = vi.fn<(body: unknown) => number | undefined>(() => 1);

    await postJsonWithRetry("https://channel.example/send", PAYLOAD, double.fetch, sleepSpy(), reader);

    expect(reader.mock.calls, "reader calls").toEqual([[{ wait: 1, other: "x" }]]);
  });

  it.each([
    { case: "missing", body: {} },
    { case: "0", body: { wait: 0 } },
    { case: "longer than 5 seconds", body: { wait: 6 } },
    { case: "negative", body: { wait: -1 } },
  ])("postJsonWithRetry does not wait for a retry-after that is $case", async ({ body }) => {
    const double = answering(jsonResponse(429, body));
    const sleep = sleepSpy();

    const answer = await postJsonWithRetry("https://channel.example/send", PAYLOAD, double.fetch, sleep, waitOf);

    expect(answer, "answer").toEqual({ kind: "answered", status: 429, ok: false, body });
    expect(sleep, "sleep").not.toHaveBeenCalled();
    expect(double.fetch, "number of requests").toHaveBeenCalledTimes(1);
  });

  it("postJsonWithRetry does not wait for a second 429", async () => {
    const double = answering(jsonResponse(429, { wait: 1 }));
    const sleep = sleepSpy();

    const answer = await postJsonWithRetry("https://channel.example/send", PAYLOAD, double.fetch, sleep, waitOf);

    expect(answer, "answer").toMatchObject({ kind: "answered", status: 429 });
    expect(sleep.mock.calls, "sleep calls").toEqual([[1000]]);
    expect(double.fetch, "number of requests").toHaveBeenCalledTimes(2);
  });

  it("postJsonWithRetry sends once and does not wait for an answer that is not a 429", async () => {
    const double = answering(jsonResponse(500, { wait: 1 }));
    const sleep = sleepSpy();

    const answer = await postJsonWithRetry("https://channel.example/send", PAYLOAD, double.fetch, sleep, waitOf);

    expect(answer, "answer").toEqual({ kind: "answered", status: 500, ok: false, body: undefined });
    expect(sleep, "sleep").not.toHaveBeenCalled();
    expect(double.fetch, "number of requests").toHaveBeenCalledTimes(1);
  });

  it("postJsonWithRetry returns failed and sends no second request when the sleep rejects", async () => {
    const double = answering(jsonResponse(429, { wait: 2 }));
    const sleep = vi.fn<(milliseconds: number) => Promise<void>>(() => Promise.reject(new Error("timer failed")));

    const answer = await postJsonWithRetry("https://channel.example/send", PAYLOAD, double.fetch, sleep, waitOf);

    expect(answer, "answer").toEqual({ kind: "failed" });
    expect(double.fetch, "number of requests").toHaveBeenCalledTimes(1);
  });

  it("postJsonWithRetry returns failed without a cause when the fetch rejects and does not wait", async () => {
    const fetcher = vi.fn<ChannelFetch>(() => Promise.reject(new TypeError(`lost ${URL_WITH_CREDENTIAL}`)));
    const sleep = sleepSpy();

    const answer = await postJsonWithRetry(URL_WITH_CREDENTIAL, PAYLOAD, fetcher, sleep, waitOf);

    expect(answer, "answer").toEqual({ kind: "failed" });
    expect(sleep, "sleep").not.toHaveBeenCalled();
  });
});
