import { exports } from "cloudflare:workers";
import { expect, it } from "vitest";
import { version } from "../package.json";
import { body, headers } from "../test/fixtures/ping/form-delivery.json";

it("GET /health answers with the version from package.json", async () => {
  const response = await exports.default.fetch("https://example.com/health");

  const body: unknown = await response.json();

  expect(response.status, "status").toBe(200);
  expect(body, "body").toEqual({ status: "ok", version });
});

it("an unknown path answers 404 with an empty body", async () => {
  const response = await exports.default.fetch("https://example.com/anything");

  expect(response.status, "status").toBe(404);
  expect(await response.text(), "body").toBe("");
});

it("POST /webhook answers 202 for the real GitHub ping delivery with the configured secret", async () => {
  const response = await exports.default.fetch("https://example.com/webhook", {
    method: "POST",
    body,
    headers,
  });

  expect(response.status, "status").toBe(202);
  expect(await response.text(), "body").toBe("");
});
