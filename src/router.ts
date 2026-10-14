import { MAX_BODY_BYTES, readBodyWithLimit } from "./body";

/** One log entry per request; nothing else about the request is logged. */
export interface RequestLogEntry {
  readonly method: string;
  readonly path: string;
  readonly status: number;
}

/** What the routes need from outside. */
export interface RouteDeps {
  readonly version: string;
  readonly log: (entry: RequestLogEntry) => void;
}

async function receiveWebhook(request: Request): Promise<Response> {
  const result = await readBodyWithLimit(request, MAX_BODY_BYTES);
  switch (result.kind) {
    case "ok":
      // The body is not used yet; signature verification reads it in a later change.
      return new Response(null, { status: 202 });
    case "too-large":
      return new Response(null, { status: 413 });
    case "unreadable":
      return new Response(null, { status: 400 });
    default: {
      const unreachable: never = result;
      return unreachable;
    }
  }
}

async function route(request: Request, pathname: string, deps: RouteDeps): Promise<Response> {
  if (pathname === "/health" && request.method === "GET") {
    return Response.json({ status: "ok", version: deps.version });
  }
  if (pathname === "/webhook" && request.method === "POST") {
    return receiveWebhook(request);
  }
  return new Response(null, { status: 404 });
}

/** Answers a request on the Worker's public routes and logs it once. */
export async function handleRequest(request: Request, deps: RouteDeps): Promise<Response> {
  const { pathname } = new URL(request.url);
  const response = await route(request, pathname, deps);
  deps.log({ method: request.method, path: pathname, status: response.status });
  return response;
}
