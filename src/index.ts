import { version } from "../package.json";
import { handleRequest } from "./router";
import type { RequestLogEntry } from "./router";
import { secretFromEnv } from "./webhook-secret";

/** Forwards a request to the global `fetch`; the one outbound path of the setup wizard. */
function outboundFetch(request: Request): Promise<Response> {
  return fetch(request);
}

function log(entry: RequestLogEntry): void {
  console.log(entry);
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, {
      version,
      log,
      webhookSecret: secretFromEnv(env),
      setup: { env, db: env.DB, now: () => new Date(), fetch: outboundFetch, githubFetch: outboundFetch, version },
    });
  },
  /** Cron triggers from `wrangler.jsonc`; no job runs yet (the jobs follow in issue #18). */
  scheduled(): Promise<void> {
    return Promise.resolve();
  },
} satisfies ExportedHandler<Env>;
