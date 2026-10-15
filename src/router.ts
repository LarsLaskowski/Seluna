import { MAX_BODY_BYTES, readBodyWithLimit } from "./body";
import { handleSetup, isSetupPath } from "./setup/handler";
import type { SetupDeps } from "./setup/handler";
import { SIGNATURE_HEADER, verifySignature } from "./signature";
import type { WebhookSecretSource } from "./webhook-secret";

/** One log entry per request; nothing else about the request is logged. */
export interface RequestLogEntry {
  readonly method: string;
  readonly path: string;
  readonly status: number;
  /** `POST /webhook` only: `X-GitHub-Delivery` when it matches its pattern, otherwise `null`. */
  readonly delivery?: string | null;
  /** `POST /webhook` only: `X-GitHub-Event` when it matches its pattern, otherwise `null`. */
  readonly event?: string | null;
}

/** What the routes need from outside. */
export interface RouteDeps {
  readonly version: string;
  readonly log: (entry: RequestLogEntry) => void;
  readonly webhookSecret: WebhookSecretSource;
  readonly setup: SetupDeps;
}

const DELIVERY_PATTERN = /^[0-9A-Za-z-]{1,64}$/;
const EVENT_PATTERN = /^[a-z_]{1,64}$/;

/** The header value when it matches `pattern`, otherwise `null`, so unauthenticated text never reaches the log. */
function boundedHeader(request: Request, name: string, pattern: RegExp): string | null {
  const value = request.headers.get(name);
  return value !== null && pattern.test(value) ? value : null;
}

async function receiveWebhook(request: Request, deps: RouteDeps): Promise<Response> {
  const result = await readBodyWithLimit(request, MAX_BODY_BYTES);
  switch (result.kind) {
    case "ok":
      return verifyWebhook(request, result.body, deps);
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

async function verifyWebhook(request: Request, body: Uint8Array, deps: RouteDeps): Promise<Response> {
  let secret: string | undefined;
  try {
    secret = await deps.webhookSecret.webhookSecret();
  } catch {
    // The error is deliberately dropped: it must reach neither the log nor the response.
    return new Response(null, { status: 503 });
  }
  if (secret === undefined || secret === "") {
    return new Response(null, { status: 503 });
  }
  const valid = await verifySignature(body, request.headers.get(SIGNATURE_HEADER), secret);
  return new Response(null, { status: valid ? 202 : 401 });
}

async function route(request: Request, pathname: string, deps: RouteDeps): Promise<Response> {
  if (pathname === "/health" && request.method === "GET") {
    return Response.json({ status: "ok", version: deps.version });
  }
  if (pathname === "/webhook" && request.method === "POST") {
    return receiveWebhook(request, deps);
  }
  if (isSetupPath(pathname)) {
    return handleSetup(request, pathname, deps.setup);
  }
  return new Response(null, { status: 404 });
}

/** Answers a request on the Worker's public routes and logs it once. */
export async function handleRequest(request: Request, deps: RouteDeps): Promise<Response> {
  const { pathname } = new URL(request.url);
  const response = await route(request, pathname, deps);
  const entry = { method: request.method, path: pathname, status: response.status };
  if (pathname === "/webhook" && request.method === "POST") {
    deps.log({
      ...entry,
      delivery: boundedHeader(request, "x-github-delivery", DELIVERY_PATTERN),
      event: boundedHeader(request, "x-github-event", EVENT_PATTERN),
    });
  } else {
    deps.log(entry);
  }
  return response;
}
