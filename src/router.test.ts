import { describe, expect, it } from "vitest";
import { body, headers, secret } from "../test/fixtures/ping/form-delivery.json";
import { MAX_BODY_BYTES } from "./body";
import { handleRequest } from "./router";
import type { RequestLogEntry, RouteDeps } from "./router";
import type { WebhookSecretSource } from "./webhook-secret";

const ORIGIN = "https://example.com";
const HALF = MAX_BODY_BYTES / 2;

const FIXTURE_SECRET_SOURCE: WebhookSecretSource = { webhookSecret: () => Promise.resolve(secret) };
const NO_SECRET_SOURCE: WebhookSecretSource = { webhookSecret: () => Promise.resolve(undefined) };
const FAILING_SECRET_SOURCE: WebhookSecretSource = {
  webhookSecret: () => Promise.reject(new Error("secret source failed")),
};
const DELIVERY_ID = "1718a4d0-c809-11f1-8378-122c40de5e00";

function makeDeps(entries: RequestLogEntry[] = [], source: WebhookSecretSource = FIXTURE_SECRET_SOURCE): RouteDeps {
  return {
    version: "1.2.3",
    log: (entry) => {
      entries.push(entry);
    },
    webhookSecret: source,
  };
}

/** `sha256=<hex>` of the HMAC-SHA256 of `bytes` under the fixture secret. */
async function sign(bytes: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, bytes));
  return `sha256=${Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/** The headers of the real delivery, with `name` set to `value` or removed when `value` is `null`. */
function deliveryHeaders(name: string, value: string | null): Headers {
  const result = new Headers(headers);
  if (value === null) {
    result.delete(name);
  } else {
    result.set(name, value);
  }
  return result;
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

function webhook(body: BodyInit | null, headers: HeadersInit = {}): Request {
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

  it("handleRequest answers 202 with an empty body for the real GitHub ping delivery", async () => {
    const request = webhook(body, headers);

    const response = await handleRequest(request, makeDeps());

    expect(response.status, "status").toBe(202);
    expect(await response.text(), "body").toBe("");
  });

  it("handleRequest answers 401 with an empty body for a webhook without X-Hub-Signature-256", async () => {
    const request = webhook("hello");

    const response = await handleRequest(request, makeDeps());

    expect(response.status, "status").toBe(401);
    expect(await response.text(), "body").toBe("");
  });

  it("handleRequest answers 401 for a webhook without a body and without a signature", async () => {
    const request = webhook(null);

    const response = await handleRequest(request, makeDeps());

    expect(response.status, "status").toBe(401);
    expect(await response.text(), "body").toBe("");
  });

  it("handleRequest answers 401 for the real delivery that carries only X-Hub-Signature", async () => {
    const request = webhook(body, deliveryHeaders("x-hub-signature-256", null));

    const response = await handleRequest(request, makeDeps());

    expect(response.status, "status").toBe(401);
    expect(await response.text(), "body").toBe("");
  });

  it("handleRequest answers 401 with an empty body for the real delivery with a wrong signature", async () => {
    const wrong = `${headers["x-hub-signature-256"].slice(0, -1)}6`;
    const request = webhook(body, deliveryHeaders("x-hub-signature-256", wrong));

    const response = await handleRequest(request, makeDeps());

    expect(response.status, "status").toBe(401);
    expect(await response.text(), "body").toBe("");
  });

  it("handleRequest answers 503 with an empty body for the real delivery when no secret is configured", async () => {
    const request = webhook(body, headers);

    const response = await handleRequest(request, makeDeps([], NO_SECRET_SOURCE));

    expect(response.status, "status").toBe(503);
    expect(await response.text(), "body").toBe("");
  });

  it("handleRequest answers 503 with an empty body when the secret source fails", async () => {
    const request = webhook(body, headers);

    const response = await handleRequest(request, makeDeps([], FAILING_SECRET_SOURCE));

    expect(response.status, "status").toBe(503);
    expect(await response.text(), "body").toBe("");
  });

  it("handleRequest answers 202 for a signed webhook body of exactly MAX_BODY_BYTES", async () => {
    const bytes = new Uint8Array(MAX_BODY_BYTES);
    const request = webhook(streamOf([bytes.subarray(0, HALF), bytes.subarray(HALF)]), {
      "x-hub-signature-256": await sign(bytes),
    });

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

  it("handleRequest answers 413 before 503 for an oversized webhook when no secret is configured", async () => {
    const request = webhook("x", { "content-length": String(MAX_BODY_BYTES + 1) });

    const response = await handleRequest(request, makeDeps([], NO_SECRET_SOURCE));

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

    expect(entries, "log entries").toEqual([
      { method: "POST", path: "/webhook", status: 413, delivery: null, event: null },
    ]);
  });

  it("handleRequest logs the real delivery with status 202, its delivery id and event", async () => {
    const entries: RequestLogEntry[] = [];
    const request = webhook(body, headers);

    await handleRequest(request, makeDeps(entries));

    expect(entries, "log entries").toEqual([
      { method: "POST", path: "/webhook", status: 202, delivery: DELIVERY_ID, event: "ping" },
    ]);
  });

  it("handleRequest logs a webhook with a wrong signature with status 401, its delivery id and event", async () => {
    const entries: RequestLogEntry[] = [];
    const wrong = `${headers["x-hub-signature-256"].slice(0, -1)}6`;
    const request = webhook(body, deliveryHeaders("x-hub-signature-256", wrong));

    await handleRequest(request, makeDeps(entries));

    expect(entries, "log entries").toEqual([
      { method: "POST", path: "/webhook", status: 401, delivery: DELIVERY_ID, event: "ping" },
    ]);
  });

  it.each([
    { header: "X-GitHub-Delivery", case: "missing", value: null, expected: { delivery: null, event: "ping" } },
    {
      header: "X-GitHub-Delivery",
      case: "65 characters long",
      value: "a".repeat(65),
      expected: { delivery: null, event: "ping" },
    },
    {
      header: "X-GitHub-Delivery",
      case: "containing a tab",
      value: "abc\tdef",
      expected: { delivery: null, event: "ping" },
    },
    {
      header: "X-GitHub-Delivery",
      case: "containing a space",
      value: "abc def",
      expected: { delivery: null, event: "ping" },
    },
    { header: "X-GitHub-Event", case: "missing", value: null, expected: { delivery: DELIVERY_ID, event: null } },
    {
      header: "X-GitHub-Event",
      case: "65 characters long",
      value: "a".repeat(65),
      expected: { delivery: DELIVERY_ID, event: null },
    },
    {
      header: "X-GitHub-Event",
      case: "containing an uppercase letter",
      value: "Ping",
      expected: { delivery: DELIVERY_ID, event: null },
    },
    {
      header: "X-GitHub-Event",
      case: "containing a tab",
      value: "pi\tng",
      expected: { delivery: DELIVERY_ID, event: null },
    },
  ])("handleRequest logs $header as null when it is $case", async ({ header, value, expected }) => {
    const entries: RequestLogEntry[] = [];
    const request = webhook(body, deliveryHeaders(header, value));

    await handleRequest(request, makeDeps(entries));

    expect(entries, "log entries").toEqual([{ method: "POST", path: "/webhook", status: 202, ...expected }]);
  });

  it("handleRequest never logs the webhook body or signature", async () => {
    const entries: RequestLogEntry[] = [];
    const request = webhook(body, headers);

    await handleRequest(request, makeDeps(entries));

    const logged = JSON.stringify(entries);
    expect(
      entries.map((entry) => entry.status),
      "statuses",
    ).toEqual([202]);
    expect(logged, "payload").not.toContain("payload=");
    expect(logged, "sha256 signature").not.toContain(headers["x-hub-signature-256"].slice(7));
    expect(logged, "sha1 signature").not.toContain(headers["x-hub-signature"].slice(5));
    expect(logged, "secret").not.toContain(secret);
  });

  it("handleRequest logs an unknown path with status 404", async () => {
    const entries: RequestLogEntry[] = [];
    const request = new Request(`${ORIGIN}/setup?code=abc`);

    await handleRequest(request, makeDeps(entries));

    expect(entries, "log entries").toEqual([{ method: "GET", path: "/setup", status: 404 }]);
  });

  it("handleRequest logs a non-webhook request without delivery and event fields", async () => {
    const entries: RequestLogEntry[] = [];
    const request = new Request(`${ORIGIN}/webhook`, { method: "GET", headers });

    await handleRequest(request, makeDeps(entries));

    expect(entries, "log entries").toStrictEqual([{ method: "GET", path: "/webhook", status: 404 }]);
  });
});
