import { expect, onTestFinished, vi } from "vitest";
import type { Mock } from "vitest";
import type { GitHubFetch } from "../src/github/conversion";
import type { AccountChoice } from "../src/github/manifest";
import installationTokenFixture from "./fixtures/github/installation-token.json";
import installationsFixture from "./fixtures/github/installations.json";
import conversionFixture from "./fixtures/github/manifest-conversion.json";
import notFoundFixture from "./fixtures/github/manifest-conversion-not-found.json";
import pkcs8Fixture from "./fixtures/github/manifest-conversion-pkcs8.json";
import validationFailedFixture from "./fixtures/github/manifest-conversion-validation-failed.json";
import pullRequestFixture from "./fixtures/github/pull-request.json";
import keySizesFixture from "./fixtures/github/rsa-key-sizes.json";
import { base64UrlOf, hmacBase64Url } from "./keys";

/*
 * The GitHub API double. Its answers come from test/fixtures/github/, which are written from GitHub's documentation
 * and OpenAPI description and not captured from GitHub (see the README.md there).
 */

/** The code of GitHub's documented example: 40 lowercase hexadecimal digits. */
export const FIXTURE_CODE = "a180b1a3d263c81bc6441d7b990bae27d4c10679";
/** The `pem` of the documented answer (PKCS#1). */
export const FIXTURE_PEM: string = conversionFixture.pem;
/** The documented key as PKCS#8 PEM, made by `openssl pkcs8 -topk8 -nocrypt`. */
export const FIXTURE_PKCS8: string = pkcs8Fixture.pkcs8;
/** The `webhook_secret` of the documented answer. */
export const FIXTURE_WEBHOOK_SECRET: string = conversionFixture.webhook_secret;
/** The `client_secret` of the documented answer, which must never be stored. */
export const FIXTURE_CLIENT_SECRET: string = conversionFixture.client_secret;

/** The answers of the fixtures, as parsed JSON. */
export const FIXTURES: Readonly<Record<"conversion" | "notFound" | "validationFailed", unknown>> = {
  conversion: conversionFixture,
  notFound: notFoundFixture,
  validationFailed: validationFailedFixture,
};

/** A fresh copy of the documented answer with the top-level fields of `changes` set (a `undefined` value removes the field). */
export function conversionAnswer(changes: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  const copy: Record<string, unknown> = structuredClone(conversionFixture);
  for (const [field, value] of Object.entries(changes)) {
    if (value === undefined) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- the helper removes a field named by its caller
      delete copy[field];
    } else {
      copy[field] = value;
    }
  }
  return copy;
}

/** A fresh copy of the documented answer whose `owner` has `login` and `type`. */
export function conversionOwnedBy(login: string, type: string): Record<string, unknown> {
  return conversionAnswer({ owner: { ...conversionFixture.owner, login, type } });
}

/** How the double answers a request. `headers` are added to the answer's (for example a `Link` header). */
export type GitHubAnswer =
  | { readonly kind: "json"; readonly status: number; readonly body: unknown; readonly headers?: HeadersInit }
  | { readonly kind: "raw"; readonly status: number; readonly body: BodyInit | null; readonly headers?: HeadersInit }
  | { readonly kind: "reject"; readonly error: unknown };

/** A JSON answer with `status`, and optional extra `headers`. */
export function jsonAnswer(status: number, body: unknown, headers?: HeadersInit): GitHubAnswer {
  return headers === undefined ? { kind: "json", status, body } : { kind: "json", status, body, headers };
}

/** The answer of a rejected `fetch` (network error). */
export const REJECTED: GitHubAnswer = { kind: "reject", error: new TypeError("Network connection lost") };

/** The requests the double knows: the manifest conversion and the three calls of the GitHub App authentication. */
export type GitHubRoute = "conversion" | "installationToken" | "installations" | "pullRequest";

/** One request the double received. */
export interface RecordedGitHubRequest {
  readonly method: string;
  readonly url: string;
  /** The route the request matched, or `undefined` for a request the double does not know (the test then fails). */
  readonly route: GitHubRoute | undefined;
  /** The path segment between `/app-manifests/` and `/conversions`, or an empty text for another URL. */
  readonly code: string;
  /** The captured path segments of the route: the installation id; the owner, the repository and the number. */
  readonly params: readonly string[];
  readonly headers: Headers;
  /** The `Authorization` header, or `null` when the request sent none. */
  readonly authorization: string | null;
  readonly redirect: Request["redirect"];
  readonly signal: AbortSignal;
  readonly hasBody: boolean;
}

/** What answers a route: one answer, a sequence (one per request, the last repeated) or a function of the request. */
export type GitHubRouteAnswer =
  | GitHubAnswer
  | readonly [GitHubAnswer, ...GitHubAnswer[]]
  | ((request: RecordedGitHubRequest) => GitHubAnswer | Promise<GitHubAnswer>);

export interface GitHubDouble {
  /** Pass this as `githubFetch` of the code under test. */
  readonly fetch: Mock<GitHubFetch>;
  /** Every request received, in order. */
  readonly requests: readonly RecordedGitHubRequest[];
}

interface RouteMatch {
  readonly route: GitHubRoute;
  readonly method: string;
  readonly pattern: RegExp;
}

const ROUTE_MATCHES: readonly RouteMatch[] = [
  {
    route: "conversion",
    method: "POST",
    pattern: /^https:\/\/api\.github\.com\/app-manifests\/([^/?#]*)\/conversions$/,
  },
  {
    route: "installationToken",
    method: "POST",
    pattern: /^https:\/\/api\.github\.com\/app\/installations\/([^/?#]*)\/access_tokens$/,
  },
  { route: "installations", method: "GET", pattern: /^https:\/\/api\.github\.com\/app\/installations\?per_page=100$/ },
  {
    route: "pullRequest",
    method: "GET",
    pattern: /^https:\/\/api\.github\.com\/repos\/([^/?#]*)\/([^/?#]*)\/pulls\/([^/?#]*)$/,
  },
];

function respond(answer: GitHubAnswer): Promise<Response> {
  switch (answer.kind) {
    case "json": {
      const headers = new Headers(answer.headers);
      headers.set("content-type", "application/json");
      return Promise.resolve(new Response(JSON.stringify(answer.body), { status: answer.status, headers }));
    }
    case "raw":
      return Promise.resolve(new Response(answer.body, { status: answer.status, headers: answer.headers }));
    case "reject":
      return Promise.reject(answer.error instanceof Error ? answer.error : new Error("rejected"));
    default: {
      const unreachable: never = answer;
      return unreachable;
    }
  }
}

function isSequence(answer: GitHubAnswer | readonly GitHubAnswer[]): answer is readonly GitHubAnswer[] {
  return Array.isArray(answer);
}

function matchRoute(request: Request): { readonly route: GitHubRoute; readonly params: readonly string[] } | undefined {
  for (const candidate of ROUTE_MATCHES) {
    const match = candidate.pattern.exec(request.url);
    if (match !== null && request.method === candidate.method) {
      return { route: candidate.route, params: match.slice(1) };
    }
  }
  return undefined;
}

/**
 * A `fetch` that stands in for `https://api.github.com`: it records every request, with its `Authorization` header,
 * and answers by method and URL: `POST /app-manifests/<code>/conversions`, `POST /app/installations/<id>/access_tokens`,
 * `GET /app/installations?per_page=100` and `GET /repos/<owner>/<repo>/pulls/<number>`. Each route in `routes` is a
 * `GitHubAnswer`, a sequence of them (one per request, the last repeated) or a function of the recorded request. A
 * request to another URL, or to a route without an answer, is answered with a rejection and fails the test that
 * created the double when the test ends.
 */
export function githubApiDouble(routes: Readonly<Partial<Record<GitHubRoute, GitHubRouteAnswer>>>): GitHubDouble {
  const requests: RecordedGitHubRequest[] = [];
  const unexpected: string[] = [];
  const counts = new Map<GitHubRoute, number>();
  const fetcher = vi.fn<GitHubFetch>(async (request) => {
    const matched = matchRoute(request);
    const recorded: RecordedGitHubRequest = {
      method: request.method,
      url: request.url,
      route: matched?.route,
      code: matched?.route === "conversion" ? (matched.params[0] ?? "") : "",
      params: matched?.params ?? [],
      headers: request.headers,
      authorization: request.headers.get("authorization"),
      redirect: request.redirect,
      signal: request.signal,
      hasBody: request.body !== null,
    };
    requests.push(recorded);
    const routeAnswer = matched === undefined ? undefined : routes[matched.route];
    if (matched === undefined || routeAnswer === undefined) {
      unexpected.push(`${request.method} ${request.url}`);
      throw new TypeError("Unexpected GitHub request");
    }
    if (typeof routeAnswer === "function") {
      return respond(await routeAnswer(recorded));
    }
    if (isSequence(routeAnswer)) {
      const index = counts.get(matched.route) ?? 0;
      counts.set(matched.route, index + 1);
      return respond(routeAnswer[Math.min(index, routeAnswer.length - 1)] ?? REJECTED);
    }
    return respond(routeAnswer);
  });

  onTestFinished(() => {
    expect(unexpected, "requests to something the GitHub API double has no answer for").toEqual([]);
  });

  return { fetch: fetcher, requests };
}

/**
 * A `fetch` that stands in for `https://api.github.com` for the manifest conversion: it records every request and
 * answers `POST /app-manifests/<code>/conversions` as given (by default with the documented 201 answer). Any other
 * request is answered with a rejection and fails the test that created the double when the test ends.
 */
export function githubDouble(answer: GitHubAnswer = jsonAnswer(201, FIXTURES.conversion)): GitHubDouble {
  return githubApiDouble({ conversion: answer });
}

/** The manifest of the plan (AC1) as JSON text, written independently of `src/github/manifest.ts`. */
export function expectedManifestJson(origin: string, account: string): string {
  return JSON.stringify({
    name: `seluna-${account}`.slice(0, 34),
    url: "https://github.com/LarsLaskowski/Seluna",
    hook_attributes: { url: `${origin}/webhook`, active: true },
    redirect_url: `${origin}/setup/github/callback`,
    public: false,
    default_permissions: {
      actions: "read",
      pull_requests: "read",
      vulnerability_alerts: "read",
      security_events: "read",
      secret_scanning_alerts: "read",
      metadata: "read",
    },
    default_events: [
      "pull_request",
      "workflow_run",
      "dependabot_alert",
      "code_scanning_alert",
      "secret_scanning_alert",
    ],
  });
}

/**
 * A state as the plan documents it, `v1.<type>.<account>.<expires>.<nonce>.<mac>` with the MAC over
 * `github-state.v1.<type>.<account>.<expires>.<nonce>.<session>`, written independently of `src/setup/github-state.ts`.
 * `key` is the `setup-github` signing key.
 */
export async function stateFor(
  key: CryptoKey,
  session: string,
  choice: AccountChoice,
  now: Date,
  nonce: string = base64UrlOf(crypto.getRandomValues(new Uint8Array(16))),
): Promise<string> {
  const expires = String(now.getTime() + 3_600_000);
  const head = `${choice.type}.${choice.account}.${expires}.${nonce}`;
  const mac = await hmacBase64Url(key, `github-state.v1.${head}.${session}`);
  return `v1.${head}.${mac}`;
}

/** The `token` of the documented installation token answer. */
export const FIXTURE_TOKEN: string = installationTokenFixture.token;
/** An RSA key of exactly 4096 bits as PKCS#8 PEM (generated with OpenSSL, grants nothing): the largest `importSigningKey` accepts. */
export const RSA_4096_PKCS8: string = keySizesFixture.bits4096;
/** An RSA key of 4104 bits as PKCS#8 PEM (generated with OpenSSL, grants nothing): above the limit of `importSigningKey`. */
export const RSA_4104_PKCS8: string = keySizesFixture.bits4104;

/** A fresh copy of the documented installation token answer with `token` and `expires_at` (a time) set. */
export function installationTokenBody(token: string, expiresAt: Date | number): Record<string, unknown> {
  const copy: Record<string, unknown> = structuredClone(installationTokenFixture);
  copy.token = token;
  copy.expires_at = new Date(expiresAt).toISOString();
  return copy;
}

/** A fresh copy of the one installation of the documented list (a `User` account, `selected`) with `changes` set. */
export function installationEntry(changes: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  const [documented] = structuredClone(installationsFixture);
  if (documented === undefined) {
    throw new Error("The documented installations list is empty");
  }
  const copy: Record<string, unknown> = documented;
  for (const [field, value] of Object.entries(changes)) {
    if (value === undefined) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- the helper removes a field named by its caller
      delete copy[field];
    } else {
      copy[field] = value;
    }
  }
  return copy;
}

/** A fresh copy of the captured pull request answer (not a draft) with `draft` set. */
export function pullRequestBody(draft = false): Record<string, unknown> {
  const copy: Record<string, unknown> = structuredClone(pullRequestFixture);
  copy.draft = draft;
  return copy;
}

/** The `draft` of the captured pull request answer. */
export const FIXTURE_PULL_REQUEST_DRAFT: boolean = pullRequestFixture.draft;
/** The `number` of the captured pull request answer. */
export const FIXTURE_PULL_REQUEST_NUMBER: number = pullRequestFixture.number;
