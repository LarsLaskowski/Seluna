import { describe, expect, it } from "vitest";
import { MAX_BODY_BYTES } from "./body";
import { handleRequest } from "./router";
import type { RequestLogEntry, RouteDeps } from "./router";

const ORIGIN = "https://example.com";
const HALF = MAX_BODY_BYTES / 2;

function makeDeps(entries: RequestLogEntry[] = []): RouteDeps {
  return {
    version: "1.2.3",
    log: (entry) => {
      entries.push(entry);
    },
  };
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

function failingStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.error(new Error("connection lost"));
    },
  });
}

function webhook(body: BodyInit | null, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}/webhook`, { method: "POST", body, headers });
}

describe("handleRequest", () => {
  it("handleRequest answers GET /health with 200 and the status and version as JSON", async () => {
    const request = new Request(`${ORIGIN}/health`);

    const response = await handleRequest(request, makeDeps());

    expect(response.status, "status").toBe(200);
    expect(response.headers.get("content-type"), "content type").toMatch(/^application\/json/);
    expect(await response.text(), "body").toBe('{"status":"ok","version":"1.2.3"}');
  });

  it("handleRequest answers POST /webhook with 202 and an empty body", async () => {
    const request = webhook("hello");

    const response = await handleRequest(request, makeDeps());

    expect(response.status, "status").toBe(202);
    expect(await response.text(), "body").toBe("");
  });

  it("handleRequest answers POST /webhook without a body with 202", async () => {
    const request = webhook(null);

    const response = await handleRequest(request, makeDeps());

    expect(response.status, "status").toBe(202);
    expect(await response.text(), "body").toBe("");
  });

  it("handleRequest answers POST /webhook with a body of exactly MAX_BODY_BYTES with 202", async () => {
    const request = webhook(streamOf([new Uint8Array(HALF), new Uint8Array(HALF)]));

    const response = await handleRequest(request, makeDeps());

    expect(response.status, "status").toBe(202);
    expect(await response.text(), "body").toBe("");
  });

  it.each([
    { method: "GET", path: "/" },
    { method: "GET", path: "/anything" },
    { method: "GET", path: "/setup" },
    { method: "GET", path: "/setup/" },
    { method: "GET", path: "/setup/app" },
    { method: "POST", path: "/setup" },
    { method: "HEAD", path: "/health" },
    { method: "POST", path: "/health" },
    { method: "GET", path: "/health/" },
    { method: "GET", path: "/HEALTH" },
    { method: "GET", path: "/webhook" },
    { method: "PUT", path: "/webhook" },
    { method: "POST", path: "/webhook/" },
  ])("handleRequest answers $method $path with 404 and an empty body", async ({ method, path }) => {
    const request = new Request(`${ORIGIN}${path}`, { method });

    const response = await handleRequest(request, makeDeps());

    expect(response.status, "status").toBe(404);
    expect(await response.text(), "body").toBe("");
  });

  it("handleRequest answers 413 for a webhook with Content-Length over MAX_BODY_BYTES", async () => {
    const request = webhook("x", { "content-length": String(MAX_BODY_BYTES + 1) });

    const response = await handleRequest(request, makeDeps());

    expect(response.status, "status").toBe(413);
    expect(await response.text(), "body").toBe("");
  });

  it("handleRequest answers 413 for a webhook body over MAX_BODY_BYTES without Content-Length", async () => {
    const request = webhook(streamOf([new Uint8Array(HALF), new Uint8Array(HALF + 1)]));

    const response = await handleRequest(request, makeDeps());

    expect(response.status, "status").toBe(413);
    expect(await response.text(), "body").toBe("");
  });

  it("handleRequest answers 413 for a webhook body over MAX_BODY_BYTES with an understated Content-Length", async () => {
    const request = webhook(streamOf([new Uint8Array(HALF), new Uint8Array(HALF + 1)]), {
      "content-length": "1",
    });

    const response = await handleRequest(request, makeDeps());

    expect(response.status, "status").toBe(413);
    expect(await response.text(), "body").toBe("");
  });

  it("handleRequest answers 400 for a webhook body stream that fails", async () => {
    const request = webhook(failingStream());

    const response = await handleRequest(request, makeDeps());

    expect(response.status, "status").toBe(400);
    expect(await response.text(), "body").toBe("");
  });

  it("handleRequest logs one entry with method, path without query string and status", async () => {
    const entries: RequestLogEntry[] = [];
    const request = new Request(`${ORIGIN}/health?token=secret`);

    await handleRequest(request, makeDeps(entries));

    expect(entries, "log entries").toEqual([{ method: "GET", path: "/health", status: 200 }]);
  });

  it("handleRequest logs a rejected webhook with status 413", async () => {
    const entries: RequestLogEntry[] = [];
    const request = webhook("x", { "content-length": String(MAX_BODY_BYTES + 1) });

    await handleRequest(request, makeDeps(entries));

    expect(entries, "log entries").toEqual([{ method: "POST", path: "/webhook", status: 413 }]);
  });

  it("handleRequest logs an unknown path with status 404", async () => {
    const entries: RequestLogEntry[] = [];
    const request = new Request(`${ORIGIN}/setup?code=abc`);

    await handleRequest(request, makeDeps(entries));

    expect(entries, "log entries").toEqual([{ method: "GET", path: "/setup", status: 404 }]);
  });
});
