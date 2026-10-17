import { MAX_BODY_BYTES, readBodyWithLimit } from "./body";
import { handleSetup, isSetupPath } from "./setup/handler";
import type { SetupDeps } from "./setup/handler";
import { SIGNATURE_HEADER, verifySignature } from "./signature";
import type { WebhookSecretSource } from "./webhook-secret";
import type { SignedDelivery, WebhookDecision, WebhookOutcome } from "./webhook";

/** One log entry per request; nothing else about the request is logged. */
export interface RequestLogEntry {
  readonly method: string;
  readonly path: string;
  readonly status: number;
  /** `POST /webhook` only: `X-GitHub-Delivery` when it matches its pattern, otherwise `null`. */
  readonly delivery?: string | null;
  /** `POST /webhook` only: `X-GitHub-Event` when it matches its pattern, otherwise `null`. */
  readonly event?: string | null;
  /** `POST /webhook` only: from the outcome, `null` when the processor did not run. */
  readonly action?: string | null;
  /** `POST /webhook` only: from the outcome, `null` when the processor did not run. */
  readonly repository?: string | null;
  /** `POST /webhook` only: from the outcome, `null` when the processor did not run. */
  readonly decision?: WebhookDecision | null;
}

/** What the routes need from outside. */
export interface RouteDeps {
  readonly version: string;
  readonly log: (entry: RequestLogEntry) => void;
  readonly webhookSecret: WebhookSecretSource;
  readonly webhook: (delivery: SignedDelivery) => Promise<WebhookOutcome>;
  readonly setup: SetupDeps;
}

const DELIVERY_PATTERN = /^[0-9A-Za-z-]{1,64}$/;
const EVENT_PATTERN = /^[a-z_]{1,64}$/;

/** The header value when it matches `pattern`, otherwise `null`, so unauthenticated text never reaches the log. */
function boundedHeader(request: Request, name: string, pattern: RegExp): string | null {
  const value = request.headers.get(name);
  return value !== null && pattern.test(value) ? value : null;
}

/** A response and, when the webhook processor ran, its outcome. */
interface Routed {
  readonly response: Response;
  readonly outcome?: WebhookOutcome;
}

async function receiveWebhook(request: Request, deps: RouteDeps): Promise<Routed> {
  const result = await readBodyWithLimit(request, MAX_BODY_BYTES);
  switch (result.kind) {
    case "ok":
      return verifyWebhook(request, result.body, deps);
    case "too-large":
      return { response: new Response(null, { status: 413 }) };
    case "unreadable":
      return { response: new Response(null, { status: 400 }) };
    default: {
      const unreachable: never = result;
      return unreachable;
    }
  }
}

async function verifyWebhook(request: Request, body: Uint8Array, deps: RouteDeps): Promise<Routed> {
  let secret: string | undefined;
  try {
    secret = await deps.webhookSecret.webhookSecret();
  } catch {
    // The error is deliberately dropped: it must reach neither the log nor the response.
    return { response: new Response(null, { status: 503 }) };
  }
  if (secret === undefined || secret === "") {
    return { response: new Response(null, { status: 503 }) };
  }
  const valid = await verifySignature(body, request.headers.get(SIGNATURE_HEADER), secret);
  if (!valid) {
    return { response: new Response(null, { status: 401 }) };
  }
  const outcome = await deps.webhook({
    delivery: boundedHeader(request, "x-github-delivery", DELIVERY_PATTERN),
    event: boundedHeader(request, "x-github-event", EVENT_PATTERN),
    contentType: request.headers.get("content-type"),
    body,
  });
  return { response: new Response(null, { status: outcome.status }), outcome };
}

async function route(request: Request, pathname: string, deps: RouteDeps): Promise<Routed> {
  if (pathname === "/health" && request.method === "GET") {
    return { response: Response.json({ status: "ok", version: deps.version }) };
  }
  if (pathname === "/webhook" && request.method === "POST") {
    return receiveWebhook(request, deps);
  }
  if (isSetupPath(pathname)) {
    return { response: await handleSetup(request, pathname, deps.setup) };
  }
  return { response: new Response(null, { status: 404 }) };
}

/** Answers a request on the Worker's public routes and logs it once. */
export async function handleRequest(request: Request, deps: RouteDeps): Promise<Response> {
  const { pathname } = new URL(request.url);
  const { response, outcome } = await route(request, pathname, deps);
  const entry = { method: request.method, path: pathname, status: response.status };
  if (pathname === "/webhook" && request.method === "POST") {
    deps.log({
      ...entry,
      delivery: boundedHeader(request, "x-github-delivery", DELIVERY_PATTERN),
      event: boundedHeader(request, "x-github-event", EVENT_PATTERN),
      action: outcome?.action ?? null,
      repository: outcome?.repository ?? null,
      decision: outcome?.decision ?? null,
    });
  } else {
    deps.log(entry);
  }
  return response;
}
