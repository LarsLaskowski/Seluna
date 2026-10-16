import { version } from "../package.json";
import { handleRequest } from "./router";
import type { RequestLogEntry } from "./router";
import { secretFromEnv } from "./webhook-secret";

function log(entry: RequestLogEntry): void {
  console.log(entry);
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, {
      version,
      log,
      webhookSecret: secretFromEnv(env),
      setup: { env, db: env.DB, now: () => new Date(), fetch: (request) => fetch(request) },
    });
  },
  /** Cron triggers from `wrangler.jsonc`; no job runs yet (the jobs follow in issue #18). */
  scheduled(): Promise<void> {
    return Promise.resolve();
  },
} satisfies ExportedHandler<Env>;
