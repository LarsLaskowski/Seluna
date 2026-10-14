# Plan: Verify the GitHub webhook signature

Source: Issue #5
Status: Draft
Tier: security — the change implements the security area *Webhook signature* (`POST /webhook`, `.squad/project.md`)
and the guarantee "a webhook with an invalid signature has no effect".

## Problem / root cause

`src/router.ts:18-21` (`receiveWebhook`) reads the body through the bounded reader and answers 202 to any request of
acceptable size; the comment there says signature verification follows in a later change. Nothing authenticates
the caller.

Claims of the issue, checked against the code:

- "Dependency #4 provides the HTTP routes" — confirmed: `src/router.ts` routes `POST /webhook`, `src/body.ts`
  provides the 1 MiB bounded reader (`readBodyWithLimit`), merged in b69fcf7.
- "Verify with `crypto.subtle.verify` over the raw body, no third-party library" — feasible: the bounded reader
  returns the raw bytes (`Uint8Array`) before any decoding; `package.json` has no runtime dependency and needs
  none.
- "The secret comes from `GITHUB_WEBHOOK_SECRET` if set, otherwise D1 (plugged in with #10)" — confirmed that
  neither exists yet: `wrangler.jsonc` declares no binding, `worker-configuration.d.ts` has an empty `Env`, and
  `src/index.ts:10` does not even take the `env` argument. There is no D1 binding yet, so only the Worker-secret
  source is built here; the interface is what #10 plugs into.
- "No secret configured → 503" — a product choice of the issue, adopted.
- "Log the delivery ID, event and the outcome" — today the log entry is method, path, status only
  (`src/router.ts:4-8`, `docs/areas/http-routes.md` *Logging*: "exactly three fields"); the plan extends the
  `POST /webhook` entry. The status is the outcome.
- AC2 "A test uses a real GitHub delivery" — satisfied by the delivery the Product Manager captured in
  `specs/issue-5/delivery/`: I checked that `body.txt` is 9523 bytes, printable ASCII only, without `"` or `\`,
  without a trailing newline, and that HMAC-SHA256(body, `my-secret`) equals the `X-Hub-Signature-256` in
  `headers.txt` (`37f380c1…3ca5`). It is a `ping` sent with `content_type=form`, so the body is
  `payload=<URL-encoded JSON>`, not JSON. That does not matter here: the signature covers the raw bytes whatever
  their format, and this change parses nothing.

Related defect found on the way: none in code. `docs/ARCHITECTURE.md` *Configuration* said the encryption key is
the only value outside D1; corrected by the Lead in this plan commit (see *Documentation updates*).

## Acceptance criteria

Test names are exact; tables are one `it.each` with one case per row.

- [ ] **AC1 — valid signature answers 202 (real delivery).** The real `ping` delivery with its own
  `X-Hub-Signature-256` and the secret `my-secret` answers 202 with an empty body.
  - `src/signature.test.ts`: `verifySignature returns true for the real GitHub ping delivery`
  - `src/router.test.ts`: `handleRequest answers 202 with an empty body for the real GitHub ping delivery`
  - `src/router.test.ts`: `handleRequest answers 202 for a signed webhook body of exactly MAX_BODY_BYTES`
    (replaces the existing `… with a body of exactly MAX_BODY_BYTES with 202`; signature computed in the test with
    `crypto.subtle.sign`)
  - `src/index.test.ts`: `POST /webhook answers 202 for the real GitHub ping delivery with the configured secret`
    (through `exports.default.fetch`, secret from the test binding, see *Test files*)
- [ ] **AC2 — missing signature answers 401.** No `X-Hub-Signature-256` → 401, empty body. A delivery that carries
  only the SHA-1 `X-Hub-Signature` counts as missing.
  - `src/signature.test.ts`: `verifySignature returns false when the header is missing`
  - `src/router.test.ts`: `handleRequest answers 401 with an empty body for a webhook without X-Hub-Signature-256`
    (replaces the existing `… answers POST /webhook with 202 and an empty body`)
  - `src/router.test.ts`: `handleRequest answers 401 for a webhook without a body and without a signature`
    (replaces the existing `… without a body with 202`)
  - `src/router.test.ts`: `handleRequest answers 401 for the real delivery that carries only X-Hub-Signature`
- [ ] **AC3 — wrong signature answers 401.** Every header form other than `sha256=` followed by exactly 64
  lowercase hex digits of the correct HMAC is rejected (the guard's forms, *Security considerations*).
  - `src/signature.test.ts`: `verifySignature returns false for $case` — table, all with the fixture's body and
    secret unless stated:
    | case | header / input |
    | ---- | -------------- |
    | the body with a trailing newline | fixture header, body + `\n` |
    | the body with one byte changed | fixture header, first byte `p` → `q` |
    | a different secret | fixture header, secret `my-secret2` |
    | the last hex digit changed | fixture digest with `5` → `6` at the end |
    | the SHA-1 signature | `sha1=27c24080c0bbec3825e844117648d77f8d52ce03` |
    | the SHA-1 digest under the sha256 prefix | `sha256=27c24080c0bbec3825e844117648d77f8d52ce03` |
    | an uppercase prefix | `SHA256=` + fixture digest |
    | uppercase hex digits | `sha256=` + fixture digest uppercased |
    | an empty digest | `sha256=` |
    | 63 hex digits | fixture value minus its last digit |
    | 65 hex digits | fixture value + `0` |
    | a non-hex digit | fixture digest with its first digit replaced by `g` |
    | the digest without prefix | fixture digest alone |
    | two values joined by a comma | fixture value + `, ` + fixture value |
    | an empty header | `""` |
  - `src/signature.test.ts`: `verifySignature returns false for an empty secret` (fixture body and header,
    secret `""`; must not throw)
  - `src/router.test.ts`: `handleRequest answers 401 with an empty body for the real delivery with a wrong signature`
- [ ] **AC4 — no secret answers 503.** No configured secret → 503 with an empty body, also when the request carries
  a valid signature; a failing secret source also answers 503.
  - `src/router.test.ts`: `handleRequest answers 503 with an empty body for the real delivery when no secret is configured`
  - `src/router.test.ts`: `handleRequest answers 503 with an empty body when the secret source fails`
  - `src/webhook-secret.test.ts`: `secretFromEnv returns GITHUB_WEBHOOK_SECRET when it is a non-empty string`
  - `src/webhook-secret.test.ts`: `secretFromEnv returns the value verbatim with surrounding whitespace`
  - `src/webhook-secret.test.ts`: `secretFromEnv returns undefined for $case` — table: the variable absent
    (`{}`), an empty string, a number, an object
- [ ] **AC5 — size limit before signature.** 413 and 400 keep answering before secret and signature: the existing
  tests `… 413 for a webhook with Content-Length over MAX_BODY_BYTES`, `… 413 … without Content-Length`,
  `… 413 … with an understated Content-Length` and `… 400 for a webhook body stream that fails` stay as they
  are (unsigned requests), with the default deps now holding a configured secret. No new test.
- [ ] **AC6 — logging.** Every `POST /webhook` log entry holds method, path, status, `delivery` and `event`;
  `delivery` is the `X-GitHub-Delivery` value when it matches `^[0-9A-Za-z-]{1,64}$`, `event` the
  `X-GitHub-Event` value when it matches `^[a-z_]{1,64}$`, otherwise `null`. Other routes keep exactly method,
  path, status. Body and signature are never logged.
  - `src/router.test.ts`: `handleRequest logs the real delivery with status 202, its delivery id and event`
    (expects `{ method: "POST", path: "/webhook", status: 202, delivery: "1718a4d0-c809-11f1-8378-122c40de5e00", event: "ping" }`)
  - `src/router.test.ts`: `handleRequest logs a webhook with a wrong signature with status 401, its delivery id and event`
  - `src/router.test.ts`: `handleRequest logs a rejected webhook with status 413` — existing test, expectation
    extended by `delivery: null, event: null` (Tester, step 5)
  - `src/router.test.ts`: `handleRequest logs $header as null when it is $case` — table: X-GitHub-Delivery
    missing, 65 characters, containing a newline, containing a space; X-GitHub-Event missing, 65 characters,
    containing an uppercase letter, containing a newline
  - `src/router.test.ts`: `handleRequest logs a non-webhook request without delivery and event fields`
    (`toStrictEqual` against the three-field entry)
  - `src/router.test.ts`: `handleRequest never logs the webhook body or signature` (the serialized entries contain
    neither `payload=` nor the fixture digest)
- [ ] **AC7 — the real delivery is stored as a fixture.** `test/fixtures/ping/form-delivery.json` holds the body
  byte for byte.
  - `src/signature.test.ts`: `the real delivery fixture body is 9523 bytes of UTF-8` (guards against a byte lost or
    added; any change also breaks AC1)

## Approach

1. **`src/signature.ts`** (new): `verifySignature(body, header, secret)` returns `false` for an empty secret, for a
   `null` header and for a header that does not match `/^sha256=([0-9a-f]{64})$/`; otherwise it decodes the 64 hex
   digits into 32 bytes, imports the UTF-8 bytes of the secret as a raw HMAC/SHA-256 key (`extractable: false`,
   usages `["verify"]`) and returns `crypto.subtle.verify("HMAC", key, digest, body)`. No string comparison of
   digests anywhere. The regex runs on the header value only (fixed length, no backtracking risk).
2. **`src/webhook-secret.ts`** (new): the `WebhookSecretSource` interface and `secretFromEnv(env)`, which reads
   `GITHUB_WEBHOOK_SECRET` with an `in` check on `env: object` and returns it when it is a non-empty string,
   otherwise `undefined` (verified with `tsc` that `Env` is assignable to `object` and the `in` check narrows
   without a cast).
3. **`src/router.ts`**: `RouteDeps` gains `webhookSecret`; `receiveWebhook(request, deps)` keeps the bounded read
   (413/400), then asks the source (rejection or `undefined` → 503), then verifies (false → 401, true → 202). All
   new responses have a `null` body. `handleRequest` adds `delivery` and `event` to the entry of a `POST /webhook`
   request (matched exactly as the route matches), each through a private helper that returns the header value
   when it matches its pattern, otherwise `null`. Remove the "body is not used yet" comment.
4. **`src/index.ts`**: `fetch(request: Request, env: Env)` passes `webhookSecret: secretFromEnv(env)`.
5. **Fixture** (Tester, step 5): `test/fixtures/ping/form-delivery.json`, generated, never typed by hand:

   ```bash
   python3 -I -c 'import json; b=open("specs/issue-5/delivery/body.txt", encoding="ascii").read(); json.dump({"description": "Real GitHub ping delivery, hook content_type=form, unaltered; throwaway secret (docs/decisions/0012-webhook-signature-verification.md)", "secret": "my-secret", "headers": {"x-github-event": "ping", "x-github-delivery": "1718a4d0-c809-11f1-8378-122c40de5e00", "x-hub-signature-256": "sha256=37f380c18e6100871752a65f1475cff398290b139af0957a6215315a3a593ca5", "x-hub-signature": "sha1=27c24080c0bbec3825e844117648d77f8d52ce03", "content-type": "application/x-www-form-urlencoded"}, "body": b}, open("test/fixtures/ping/form-delivery.json", "w"), indent=2)'
   ```

   (run from the repository root after `mkdir -p test/fixtures/ping`), then *Format*. **Byte exactness:** the body
   is printable ASCII without `"` or `\`, so the JSON string holds it with no escape at all and decodes to exactly
   the 9523 captured bytes; Prettier and Git line-ending conversion change only whitespace between JSON tokens,
   never inside the string, and a final newline of the file is outside the string — so no `.gitattributes` or
   Prettier ignore is needed. Check after generating: `python3 -I -c 'import json,hashlib; b=json.load(open("test/fixtures/ping/form-delivery.json"))["body"].encode(); print(len(b), b==open("specs/issue-5/delivery/body.txt","rb").read())'`
   prints `9523 True` (once more after *Format*). Tests import it with named JSON imports
   (`import { body, headers, secret } from "../test/fixtures/ping/form-delivery.json"`, as `src/index.ts` already
   imports `package.json`) and turn `body` into bytes with `new TextEncoder().encode(body)`.
6. **Test binding** (Tester, step 5): `vitest.config.ts` passes `miniflare: { bindings: { GITHUB_WEBHOOK_SECRET:
   "my-secret" } }` to `cloudflareTest(...)`, with a comment that it is the fixture's throwaway secret, so the
   index test runs the real delivery through the Worker entry point. If a local `.dev.vars` should override it, the
   index test fails visibly (401) — the Dev reports that instead of working around it.

## Options considered

Recorded with the reasons in [decision 0012](../../docs/decisions/0012-webhook-signature-verification.md):

- comparison: `crypto.subtle.verify` (chosen) vs `sign` plus a comparison — the issue asks for `verify`, and a
  hand-written comparison is a timing risk;
- accepted header forms: GitHub's exact `sha256=` + 64 lowercase hex (chosen) vs also uppercase hex or the SHA-1
  header — more forms, no delivery needs them, SHA-1 would be a downgrade;
- order: size → secret → signature (chosen, keeps decision 0011) vs rejecting a missing header before reading the
  body;
- secret source: injected interface reading `env` by `in` narrowing (chosen) vs `secrets.required` in
  `wrangler.jsonc` (types an optional secret as always present) vs the global `env` import (not replaceable in
  tests);
- log entry: delivery id and event, bounded by pattern, status as outcome (chosen) vs a named outcome field;
- fixture storage: one JSON file with the body as a string (chosen) vs a raw `.txt` body plus `.gitattributes`
  and a formatter ignore (an editor's final newline breaks it silently; needs a text-module import in the test
  pool).

## Affected projects and types

| Project | Type / file | Change |
| ------- | ----------- | ------ |
| Worker | `src/signature.ts` | new: `verifySignature`, `SIGNATURE_HEADER` |
| Worker | `src/webhook-secret.ts` | new: `WebhookSecretSource`, `secretFromEnv`, `WEBHOOK_SECRET_NAME` |
| Worker | `src/router.ts` | `RouteDeps.webhookSecret`, `RequestLogEntry.delivery`/`event`, `receiveWebhook` flow, header helpers |
| Worker | `src/index.ts` | `fetch` takes `env`, wires `secretFromEnv` |
| Tests | `src/signature.test.ts`, `src/webhook-secret.test.ts` | new |
| Tests | `src/router.test.ts`, `src/index.test.ts` | extended / adapted |
| Tests | `test/fixtures/ping/form-delivery.json` | new real delivery fixture |
| Test config | `vitest.config.ts` | test binding `GITHUB_WEBHOOK_SECRET` |
| Docs | `docs/areas/http-routes.md` | routes, signature, logging (Dev) |
| Docs | `docs/ARCHITECTURE.md`, `docs/decisions/0011-…`, `docs/decisions/0012-…`, `docs/decisions/README.md` | done by the Lead in this plan commit |

`src/body.ts`, `wrangler.jsonc`, `worker-configuration.d.ts`, `tsconfig.json` and `package.json` stay unchanged
(read and found final: no binding is declared for an optional secret, JSON imports already resolve).

## Signatures (for the Dev's skeleton)

`src/signature.ts`:

```ts
/** Header carrying GitHub's HMAC-SHA256 signature of the raw body. */
export const SIGNATURE_HEADER = "x-hub-signature-256";

/**
 * Whether `signatureHeader` is GitHub's `sha256=<64 lowercase hex digits>` HMAC-SHA256 of `body` under `secret`,
 * compared in constant time by `crypto.subtle.verify`. `false` for a missing or malformed header and for an
 * empty secret; never throws for those.
 */
export async function verifySignature(body: Uint8Array, signatureHeader: string | null, secret: string): Promise<boolean>;
```

`src/webhook-secret.ts`:

```ts
/** Name of the Worker secret that holds the webhook secret. */
export const WEBHOOK_SECRET_NAME = "GITHUB_WEBHOOK_SECRET";

/** Where the webhook secret comes from; resolves to `undefined` when none is configured. */
export interface WebhookSecretSource {
  readonly webhookSecret: () => Promise<string | undefined>;
}

/** The webhook secret from the Worker environment: `GITHUB_WEBHOOK_SECRET` when it is a non-empty string. */
export function secretFromEnv(env: object): WebhookSecretSource;
```

`src/router.ts` (changed members):

```ts
export interface RequestLogEntry {
  readonly method: string;
  readonly path: string;
  readonly status: number;
  /** `POST /webhook` only: `X-GitHub-Delivery` when it matches its pattern, otherwise `null`. */
  readonly delivery?: string | null;
  /** `POST /webhook` only: `X-GitHub-Event` when it matches its pattern, otherwise `null`. */
  readonly event?: string | null;
}

export interface RouteDeps {
  readonly version: string;
  readonly log: (entry: RequestLogEntry) => void;
  readonly webhookSecret: WebhookSecretSource;
}

// private: async function receiveWebhook(request: Request, deps: RouteDeps): Promise<Response>
```

`src/index.ts`: `fetch(request: Request, env: Env): Promise<Response>` inside the existing
`satisfies ExportedHandler<Env>`.

## Test files

- `src/signature.test.ts` (new) — AC1, AC2, AC3, AC7 for `verifySignature`.
- `src/webhook-secret.test.ts` (new) — AC4 for `secretFromEnv`.
- `src/router.test.ts` (extended) — AC1–AC6 through `handleRequest`; helper `sign(body, secret)` with
  `crypto.subtle.sign` for non-fixture bodies; `makeDeps(entries, source)` with a default source that resolves to
  the fixture secret, a fake source resolving to `undefined`, and one that rejects.
- `src/index.test.ts` (extended) — AC1 through the Worker entry point.
- `test/fixtures/ping/form-delivery.json` (new fixture) and `vitest.config.ts` (test binding) — Tester.

Existing test call sites of a changed signature: `makeDeps` in `src/router.test.ts` builds a `RouteDeps`, which
stops compiling when `webhookSecret` is added. The **Dev** adapts it in step 4 mechanically (adds a
`webhookSecret` source resolving to `undefined`, no assertion touched). The **Tester** then rewrites the three
existing 202 tests and extends the 413 log test as listed under AC1, AC2 and AC6 — behavior changes, so they are
step-5 tests that fail on the skeleton.

Files of the change no unit test can cover: none (`src/index.ts` is covered by `src/index.test.ts`).

## Areas

`docs/areas/http-routes.md` (owner: **Dev**, step 6):

- *Routes* table: `POST /webhook` rows 202 (valid signature), 401 (missing or wrong signature), 503 (no webhook
  secret configured), all with an empty body; replace the bullet "reads the request body … does nothing else
  with it yet" by a new subsection *Webhook signature*: the order (size limit, then secret, then signature);
  accepted form exactly `sha256=` + 64 lowercase hex digits of HMAC-SHA256 over the raw body bytes as received,
  compared in constant time; `X-Hub-Signature` (SHA-1) is ignored, a delivery with only that header is unsigned;
  the secret is the `GITHUB_WEBHOOK_SECRET` Worker secret, used verbatim, an empty value counts as not
  configured; a failing secret source answers 503; a 202 has no further effect yet (processing follows later).
- *Logging*: "exactly three fields" becomes: three fields, and for `POST /webhook` additionally `delivery` and
  `event` with their patterns and `null` otherwise; headers other than these two values, bodies and signatures
  are never logged.
- *Limits and errors*: 401 and 503 also never carry a body.
- *Related decisions*: add 0012. *Not here*: drop "Webhook signature verification", keep event processing.
- Index row in `docs/areas/README.md`: *Not here* becomes "Webhook event processing, the setup wizard" and the
  scope adds "the webhook signature check" (Dev, same step).

## Documentation updates

- `docs/areas/http-routes.md`, `docs/areas/README.md` index row — Dev (above).
- `docs/ARCHITECTURE.md` (*Webhook to Telegram* step 1: 503 without a secret, link to 0012; *Configuration*: the
  optional `GITHUB_WEBHOOK_SECRET` Worker secret) — Lead, done in this plan commit.
- `docs/decisions/0011-public-http-surface.md` (unreleased, edited in place: the webhook log entry adds delivery
  id and event) — Lead, done.
- `README.md` — none: it has no settings table yet ("not usable yet"); the setup instructions that name the secret
  come with the deploy and setup issues.
- `.squad/project.md` — none: *Webhook signature* and *Logging of external data* already describe this behavior.

## Architecture check

- "A webhook with an invalid signature has no effect": strengthened — 401/503 return before anything uses the
  body, and today a 202 also has no effect yet.
- Decision 0011 (bounded reader first): kept; the signature is computed over the bytes the bounded reader returns.
- Decision 0007 (credentials encrypted in D1): not weakened — the Worker secret is a Cloudflare-encrypted secret,
  not stored in D1 in plain text; the D1 source follows in #10 behind the same interface.
- Decision 0005 (one instance per user): unaffected.
- No guarantee in `.squad/project.md` is weakened, so no Product Manager decision is needed.

## Security considerations

- [x] Limits: the 1 MiB body limit applies to the raw bytes before any decoding (unchanged); the HMAC runs over
  those same raw bytes, nothing is decoded. The log patterns bound the header *string* to 64 characters; both
  patterns are ASCII-only, so characters equal bytes. The signature header is matched against a fixed-length
  pattern before any work.
- [x] Exceptions reaching a user-visible answer: none carries text. `importKey` throws on an empty key — prevented
  by the empty-secret check in `verifySignature` and in `secretFromEnv`. A rejecting secret source is caught and
  answered 503 with an empty body. No other exception is expected from `verify` with a valid key and 32-byte
  digest; if the runtime threw anyway, the runtime's generic 500 reveals nothing.
- **Guard forms** (the accepted-form check on `X-Hub-Signature-256`): `Headers.get` returns the value with leading
  and trailing whitespace stripped (Fetch value normalization) and several header lines joined by `, `. Forms and
  behavior: absent → `null` → 401; empty → 401; `sha256=` + 64 lowercase hex → verified; uppercase prefix,
  uppercase hex, other algorithm prefix (`sha1=`, `sha512=`), no prefix, too short/long digest, non-hex, two
  joined values → 401 (AC3 table); surrounding whitespace → stripped by the runtime, then verified like the plain
  value. Header name lookup is case-insensitive by the Fetch standard.
- Timing: only the format check is variable-time and depends on the attacker's own input; the digest comparison is
  `crypto.subtle.verify`.
- Logging: `delivery` and `event` arrive before authentication; the patterns exclude newlines, spaces and long
  values, so a forged request cannot inject text into a log entry.
- The fixture's secret `my-secret` is public by design (decision 0012); the fixture also contains a webhook.site
  delivery URL of the hook that captured it.

## Decision records

- `docs/decisions/0012-webhook-signature-verification.md` (Proposed, indexed).
- `docs/decisions/0011-public-http-surface.md` — unreleased, edited in place (log entry of `POST /webhook`).

## Out of scope / follow-ups

- The D1 source for the webhook secret and which source wins: issue #10.
- Parsing the body, deduplication by `X-GitHub-Delivery`, rules: later issues (they need a real JSON sample).
- Residual for the Product Manager (no code): delete the webhook.site hook/inbox and the test repository's hook
  that used `my-secret`, since both are now public.

## Challenge notes

Minor objections of the Devil's Advocate (verbatim):

1. **Missing order test for 413 before 503.** AC5 keeps the 413 and 400 tests running with a configured secret. Nothing proves that an oversized or unreadable body still answers 413 or 400 when no secret is configured, although decision 0012 option 5 and the *Security considerations* depend on that order. Add one test: `handleRequest answers 413 before 503 for an oversized webhook when no secret is configured`. A second one for a failing stream with no secret is optional.
2. **A 202 test must also pin `delivery` and `event`.** AC6 expects `delivery` and `event` in the 202 log entry. Make the "never logs the webhook body or signature" test run a signed request. A 401 run proves nothing about the 202 path, where the body has just been verified. The `JSON.stringify` of all entries must contain neither `payload=` nor the fixture digest, and must contain neither the `sha1=` value nor the secret `my-secret`.

Security plan review: APPROVED. Non-blocking notes for the Reviewer: the secret source's caught error must not reach the log or the response (no `console.error(err)`); a throwing `verifySignature` would give the runtime's generic 500 without a log entry (optional try/catch answering 401).
