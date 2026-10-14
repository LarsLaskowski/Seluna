import { exports } from "cloudflare:workers";
import { expect, it } from "vitest";

it("answers every request with 404", async () => {
  const response = await exports.default.fetch("https://example.com/anything");
  expect(response.status).toBe(404);
});
