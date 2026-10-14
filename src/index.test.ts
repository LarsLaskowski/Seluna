import { exports } from "cloudflare:workers";
import { expect, it } from "vitest";
import { version } from "../package.json";

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
