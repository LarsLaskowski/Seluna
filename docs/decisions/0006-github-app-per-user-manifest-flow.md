# 0006: A GitHub App per user, created through the manifest flow

- **Status:** Accepted
- **Date:** 2026-10-14
- **Area:** —
- **Source:** Issue #2
- **Supersedes:** —

## Context

Webhooks need a GitHub App (or per-repository webhooks) that can send events to the user's Worker URL. The Worker's
URL differs for every instance, so one shared App cannot point at all of them.

## Options considered

1. **One shared GitHub App** — one install link, but the webhook URL is fixed, so a central relay would be needed (see decision 0005).
2. **Per-repository webhooks with a personal access token** — no App, but a long-lived broad token and one webhook to maintain per repository; no security-alert events for the user's repositories without extra scopes.
3. **A private GitHub App per user, created through the manifest flow** — the `/setup` wizard posts an App manifest with the instance's own webhook URL and minimal permissions; GitHub returns the App credentials once.

## Decision

Each instance creates its own private GitHub App through the GitHub App manifest flow, with the minimum permissions the rules need and the instance's own `POST /webhook` URL.

## Consequences

The user clicks through one GitHub confirmation during setup. The App's credentials (private key, webhook secret) exist only in that instance (decision 0007). Permission changes need the user to accept them on GitHub.
