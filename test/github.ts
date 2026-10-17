import { expect, onTestFinished, vi } from "vitest";
import type { Mock } from "vitest";
import type { GitHubFetch } from "../src/github/conversion";
import type { AccountChoice } from "../src/github/manifest";
import conversionFixture from "./fixtures/github/manifest-conversion.json";
import notFoundFixture from "./fixtures/github/manifest-conversion-not-found.json";
import pkcs8Fixture from "./fixtures/github/manifest-conversion-pkcs8.json";
import validationFailedFixture from "./fixtures/github/manifest-conversion-validation-failed.json";
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

/** How the double answers the conversion request. */
export type GitHubAnswer =
  | { readonly kind: "json"; readonly status: number; readonly body: unknown }
  | { readonly kind: "raw"; readonly status: number; readonly body: BodyInit | null; readonly headers?: HeadersInit }
  | { readonly kind: "reject"; readonly error: unknown };

/** A JSON answer with `status`. */
export function jsonAnswer(status: number, body: unknown): GitHubAnswer {
  return { kind: "json", status, body };
}

/** The answer of a rejected `fetch` (network error). */
export const REJECTED: GitHubAnswer = { kind: "reject", error: new TypeError("Network connection lost") };

/** One request the double received. */
export interface RecordedGitHubRequest {
  readonly method: string;
  readonly url: string;
  /** The path segment between `/app-manifests/` and `/conversions`, or an empty text for another URL. */
  readonly code: string;
  readonly headers: Headers;
  readonly redirect: Request["redirect"];
  readonly signal: AbortSignal;
  readonly hasBody: boolean;
}

export interface GitHubDouble {
  /** Pass this as `githubFetch` of the code under test. */
  readonly fetch: Mock<GitHubFetch>;
  /** Every request received, in order. */
  readonly requests: readonly RecordedGitHubRequest[];
}

const CONVERSION_URL = /^https:\/\/api\.github\.com\/app-manifests\/([^/?#]*)\/conversions$/;

function respond(answer: GitHubAnswer): Promise<Response> {
  switch (answer.kind) {
    case "json":
      return Promise.resolve(
        new Response(JSON.stringify(answer.body), {
          status: answer.status,
          headers: { "content-type": "application/json" },
        }),
      );
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

/**
 * A `fetch` that stands in for `https://api.github.com`: it records every request and answers
 * `POST /app-manifests/<code>/conversions` as given (by default with the documented 201 answer). Any other request
 * is answered with a rejection and fails the test that created the double when the test ends.
 */
export function githubDouble(answer: GitHubAnswer = jsonAnswer(201, FIXTURES.conversion)): GitHubDouble {
  const requests: RecordedGitHubRequest[] = [];
  const unexpected: string[] = [];
  const fetcher = vi.fn<GitHubFetch>((request) => {
    const code = CONVERSION_URL.exec(request.url)?.[1];
    requests.push({
      method: request.method,
      url: request.url,
      code: code ?? "",
      headers: request.headers,
      redirect: request.redirect,
      signal: request.signal,
      hasBody: request.body !== null,
    });
    if (code === undefined || request.method !== "POST") {
      unexpected.push(`${request.method} ${request.url}`);
      return Promise.reject(new TypeError("Unexpected GitHub request"));
    }
    return respond(answer);
  });

  onTestFinished(() => {
    expect(unexpected, "requests to something other than the manifest conversion on api.github.com").toEqual([]);
  });

  return { fetch: fetcher, requests };
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
