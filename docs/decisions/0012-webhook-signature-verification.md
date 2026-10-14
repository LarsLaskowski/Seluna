# 0012: Webhook signature verification

- **Status:** Accepted
- **Date:** 2026-10-14
- **Area:** HTTP routes
- **Source:** Issue #5
- **Supersedes:** —

## Context

`POST /webhook` is reachable by anyone on the internet; only GitHub may trigger processing. GitHub signs every
delivery with the hook's secret: `X-Hub-Signature-256` carries `sha256=` and the lowercase hex HMAC-SHA256 of the
raw request body, and the older `X-Hub-Signature` carries an HMAC-SHA1. The guarantee "a webhook with an invalid
signature has no effect" ([`ARCHITECTURE.md`](../ARCHITECTURE.md#webhook-to-telegram)) needs this check before
anything reads the body's content. Issue #5 asks for `crypto.subtle.verify` (constant time) without a library,
401 for a missing or wrong signature, 503 when no secret is configured (so a setup gap is told apart from a
forged request in GitHub's delivery log), and a small source for the secret: the `GITHUB_WEBHOOK_SECRET` Worker
secret now, the encrypted value in D1 ([decision 0007](0007-github-app-credentials-encrypted-in-d1.md)) once the
setup wizard exists (issue #10). Body size is limited before anything else
([decision 0011](0011-public-http-surface.md)).

## Options considered

How the signature is compared:

1. **`crypto.subtle.verify` with an HMAC key imported from the secret** — constant time by the runtime, Web
   standard, no dependency. Chosen.
2. **`crypto.subtle.sign` and a hand-written or `timingSafeEqual` comparison** — more code, and an easy place for a
   timing leak or a length shortcut.

Which header forms are accepted:

3. **Only `X-Hub-Signature-256` in GitHub's exact form (`sha256=` and 64 lowercase hex digits)** — every other
   form, including the SHA-1 header alone, is a missing or wrong signature. Chosen: nothing GitHub sends is
   rejected, and a downgrade to SHA-1 is impossible.
4. **Also accept uppercase hex or the `X-Hub-Signature` SHA-1 header** — more forms to reason about for no
   delivery GitHub actually sends.

The order of the checks:

5. **Body size first (413/400), then the secret (503), then the signature (401)** — keeps decision 0011's order
   (the bounded read precedes any use of the body), and without a secret no answer can tell a forged request from
   a genuine one. Chosen.
6. **Reject a missing signature header before reading the body** — saves reading an unsigned body, but splits
   the rules for the same route and gains nothing the 1 MiB bound does not already cap.

Where the secret comes from and how it is typed:

7. **A source interface the route receives, read from the injected Worker environment by a narrowing `in` check**
   — the D1 source of issue #10 plugs in behind the same interface; tests pass a fake. Chosen.
8. **Declaring the secret under `secrets.required` in `wrangler.jsonc`** — `wrangler types` would type it as always
   present and local development would warn without it, although it is optional once D1 holds the secret.
9. **The global `env` import of the Workers runtime inside the module** — a hidden dependency the route tests
   cannot replace.

What the webhook log entry holds:

10. **The request entry plus the delivery id and the event, each only when it has the expected character set and
    length, the status being the outcome** — chosen: these headers arrive before the signature is checked, so they
    are attacker-controlled and are bounded before they reach a log. A separate named outcome (missing vs wrong
    signature) was left out; both answer 401 and GitHub's delivery log shows which header was sent.

How the real delivery is kept as a test fixture:

11. **One JSON file holding the raw body as a string, the headers and the secret** — the body is printable ASCII
    without a quote or backslash, so the JSON string holds it verbatim, the formatter and line-ending conversion
    cannot change it, and the test imports it typed. Chosen.
12. **The raw body as a `.txt` file beside a metadata file**, protected by `.gitattributes` and a formatter ignore
    — byte-exact on disk, but an editor's final newline breaks it silently and the test runner needs a text-module
    import.

## Decision

`POST /webhook` answers 202 only when `X-Hub-Signature-256` is GitHub's `sha256=` form of an HMAC-SHA256 over the
raw body under the configured secret, checked with `crypto.subtle.verify` after the size limit and before anything
else uses the body; otherwise 401, and 503 when no secret is configured or the source fails. The secret comes from
a source interface, today the `GITHUB_WEBHOOK_SECRET` Worker secret. The rules are in the area document
[`areas/http-routes.md`](../areas/http-routes.md).

## Consequences

- The signature check is independent of the body's format: the real delivery the tests use was sent with the hook
  setting `content_type=form` (`payload=` and URL-encoded JSON), not JSON, and verifies the same way. Parsing,
  which issue #5 does not add, will need its own real JSON sample.
- The fixture `test/fixtures/ping/form-delivery.json` is a real `ping` delivery, unaltered, because removing
  anything would break its signature. Its secret `my-secret` is a throwaway secret and public from now on; the hook
  that sent it must never use it again. The body names the private test repository `LarsLaskowski/test`, its owner's
  login and ids, the hook id and the hook's delivery URL on webhook.site; GitHub masks the hook's secret in the body.
- A `POST /webhook` log entry carries two fields more than the other routes ([decision 0011](0011-public-http-surface.md)).
- An empty `GITHUB_WEBHOOK_SECRET` counts as not configured; any other value is used verbatim, without trimming.
- Issue #10 adds the D1 source behind the same interface and decides there which source wins; a D1 error must keep
  answering 503, never 202.
