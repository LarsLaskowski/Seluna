import { version } from "../package.json";
import { handleRequest } from "./router";
import type { RequestLogEntry } from "./router";

function log(entry: RequestLogEntry): void {
  console.log(entry);
}

export default {
  fetch(request: Request): Promise<Response> {
    return handleRequest(request, { version, log });
  },
} satisfies ExportedHandler;
