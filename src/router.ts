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

/** Answers a request on the Worker's public routes and logs it once. */
export function handleRequest(request: Request, deps: RouteDeps): Promise<Response> {
  throw new Error("Not implemented");
}
