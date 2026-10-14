import { describe, expect, it } from "vitest";
import { parseContentLength, readBodyWithLimit } from "./body";

const MAX_BYTES = 8;
const URL = "https://example.com/webhook";

function bytes(length: number): Uint8Array {
  return new Uint8Array(length).fill(7);
}

function streamOf(chunks: readonly Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
}

function postWith(body: BodyInit | null, headers: Record<string, string> = {}): Request {
  return new Request(URL, { method: "POST", body, headers });
}

describe("parseContentLength", () => {
  it.each([
    { value: null, expected: undefined },
    { value: "0", expected: 0 },
    { value: "1048576", expected: 1_048_576 },
    { value: "001048577", expected: 1_048_577 },
    { value: "99999999999999999999", expected: 1e20 },
    { value: "", expected: undefined },
    { value: "+5", expected: undefined },
    { value: "-1", expected: undefined },
    { value: "1e7", expected: undefined },
    { value: "0x100001", expected: undefined },
    { value: "5.0", expected: undefined },
    { value: "5, 5", expected: undefined },
  ])("parseContentLength returns $expected for $value", ({ value, expected }) => {
    const result = parseContentLength(value);

    expect(result, "parsed byte count").toBe(expected);
  });
});

describe("readBodyWithLimit", () => {
  it("readBodyWithLimit returns the bytes of a body within maxBytes", async () => {
    const request = postWith(new Uint8Array([1, 2, 3, 4, 5]));

    const result = await readBodyWithLimit(request, MAX_BYTES);

    expect(result, "result with the body bytes").toEqual({ kind: "ok", body: new Uint8Array([1, 2, 3, 4, 5]) });
  });

  it("readBodyWithLimit returns an empty body for a request without body", async () => {
    const request = new Request(URL, { method: "POST" });

    const result = await readBodyWithLimit(request, MAX_BYTES);

    expect(result, "result with an empty body").toEqual({ kind: "ok", body: new Uint8Array(0) });
  });

  it("readBodyWithLimit accepts a body of exactly maxBytes", async () => {
    const request = postWith(streamOf([bytes(4), bytes(4)]));

    const result = await readBodyWithLimit(request, MAX_BYTES);

    expect(result, "result with all bytes").toEqual({ kind: "ok", body: bytes(MAX_BYTES) });
  });

  it("readBodyWithLimit rejects a body one byte over maxBytes without Content-Length", async () => {
    const request = postWith(streamOf([bytes(4), bytes(5)]));

    const result = await readBodyWithLimit(request, MAX_BYTES);

    expect(result, "too-large result").toEqual({ kind: "too-large" });
  });

  it("readBodyWithLimit rejects a Content-Length over maxBytes before reading the body", async () => {
    const failingBody = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error("body must not be read"));
      },
    });
    const request = postWith(failingBody, { "content-length": String(MAX_BYTES + 1) });

    const result = await readBodyWithLimit(request, MAX_BYTES);

    expect(result, "too-large result, not unreadable").toEqual({ kind: "too-large" });
  });

  it("readBodyWithLimit counts the body when Content-Length understates it", async () => {
    const request = postWith(streamOf([bytes(MAX_BYTES + 1)]), { "content-length": "1" });

    const result = await readBodyWithLimit(request, MAX_BYTES);

    expect(result, "too-large result").toEqual({ kind: "too-large" });
  });

  it("readBodyWithLimit stops reading an endless stream once maxBytes is exceeded", async () => {
    const chunkSize = 4;
    let pulls = 0;
    let cancelled = false;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(bytes(chunkSize));
      },
      cancel() {
        cancelled = true;
      },
    });
    const request = postWith(endless);

    const result = await readBodyWithLimit(request, MAX_BYTES);

    expect(result, "too-large result").toEqual({ kind: "too-large" });
    expect(cancelled, "stream was cancelled").toBe(true);
    expect(pulls, "pull count stays near maxBytes / chunkSize").toBeLessThanOrEqual(MAX_BYTES / chunkSize + 3);
  });

  it("readBodyWithLimit returns unreadable for a body stream that yields non-byte chunks", async () => {
    let cancelled = false;
    const textual = new ReadableStream({
      start(controller) {
        controller.enqueue("not bytes");
      },
      cancel() {
        cancelled = true;
      },
    });
    const request = postWith(textual);

    const result = await readBodyWithLimit(request, MAX_BYTES);

    expect(result, "unreadable result").toEqual({ kind: "unreadable" });
    expect(cancelled, "stream was cancelled").toBe(true);
  });

  it("readBodyWithLimit returns unreadable for a body stream that fails", async () => {
    const failing = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error("connection lost"));
      },
    });
    const request = postWith(failing);

    const result = await readBodyWithLimit(request, MAX_BYTES);

    expect(result, "unreadable result").toEqual({ kind: "unreadable" });
  });
});
