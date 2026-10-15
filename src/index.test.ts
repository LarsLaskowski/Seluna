import { createExecutionContext, createScheduledController, waitOnExecutionContext } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { afterEach, expect, it, vi } from "vitest";
import worker from "./index";
import { version } from "../package.json";
import { body, headers } from "../test/fixtures/ping/form-delivery.json";

afterEach(() => {
  vi.restoreAllMocks();
});

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

const FIXED_SCHEDULED_TIME = 1_700_000_000_000;

it.each(["*/10 * * * *", "17 5 * * *"])(
  "the scheduled handler completes without effect for the cron %s",
  async (cron) => {
    const handler: ExportedHandler<Env> = worker;
    const log = vi.spyOn(console, "log");
    const controller = createScheduledController({ cron, scheduledTime: FIXED_SCHEDULED_TIME });
    const ctx = createExecutionContext();

    expect(handler.scheduled, "scheduled handler").toBeTypeOf("function");
    const result = await handler.scheduled?.(controller, env, ctx);

    expect(result, "result").toBeUndefined();
    expect(log, "console.log calls").not.toHaveBeenCalled();
    await expect(waitOnExecutionContext(ctx), "pending work on the execution context").resolves.toBeUndefined();
  },
);
