# 0007: GitHub App credentials encrypted in D1

- **Status:** Accepted
- **Date:** 2026-10-14
- **Area:** —
- **Source:** Issue #2
- **Supersedes:** —

## Context

After the manifest flow the instance must keep the App's private key and webhook secret between requests. Worker
secrets can only be set through Wrangler or the dashboard, not by the Worker itself during `/setup`.

## Options considered

1. **Worker secrets (`wrangler secret put`)** — never stored in the database, but the user must run an extra step and the setup wizard cannot finish on its own.
2. **Plaintext in D1** — trivial, but a database export or backup exposes the keys.
3. **Encrypted in D1 (AES-256-GCM)** — the wizard stores them itself; the encryption key is a Worker secret that never enters the database, so a database leak alone reveals nothing.

## Decision

The GitHub App credentials are stored in the D1 table `secrets`, encrypted with AES-256-GCM under a key held as a Worker secret; they are decrypted only in memory when needed. The Telegram bot token is a Worker secret, not a value in D1 ([decision 0013](0013-deploy-to-cloudflare-and-workers-builds.md)).

## Consequences

A database dump is useless without the Worker secret. Losing the key means running the setup again. Key rotation is a deliberate procedure, not an automatic one.
