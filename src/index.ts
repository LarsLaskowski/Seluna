import { version } from "../package.json";
import { handleRequest } from "./router";
import { wait } from "./delivery";
import { RULES } from "./rules/registry";
import { processWebhook } from "./webhook";
import { webhookSecretSource } from "./webhook-secret";

/** Forwards a request to the global `fetch`; the one outbound path of the setup wizard. */
function outboundFetch(request: Request): Promise<Response> {
  return fetch(request);
}

function log(entry: unknown): void {
  console.log(entry);
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handleRequest(request, {
      version,
      log,
      webhookSecret: webhookSecretSource(env, env.DB),
      webhook: (delivery) =>
        processWebhook(delivery, {
          db: env.DB,
          env,
          now: () => new Date(),
          rules: RULES,
          waitUntil: (promise) => {
            ctx.waitUntil(promise);
          },
          telegramFetch: outboundFetch,
          sleep: wait,
          log,
        }),
      setup: { env, db: env.DB, now: () => new Date(), fetch: outboundFetch, githubFetch: outboundFetch, version },
    });
  },
  /** Cron triggers from `wrangler.jsonc`; no job runs yet (the jobs follow in issue #18). */
  scheduled(): Promise<void> {
    return Promise.resolve();
  },
} satisfies ExportedHandler<Env>;
