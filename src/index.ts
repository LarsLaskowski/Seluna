import { version } from "../package.json";
import { handleRequest } from "./router";
import type { RequestLogEntry } from "./router";
import { secretFromEnv } from "./webhook-secret";

function log(entry: RequestLogEntry): void {
  console.log(entry);
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, { version, log, webhookSecret: secretFromEnv(env) });
  },
} satisfies ExportedHandler<Env>;
