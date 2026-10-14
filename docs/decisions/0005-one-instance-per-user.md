# 0005: One instance per user instead of a central service

- **Status:** Accepted
- **Date:** 2026-10-14
- **Area:** —
- **Source:** Issue #2
- **Supersedes:** —

## Context

Seluna forwards events from a user's GitHub repositories to the user's Telegram. A central service would receive
every user's webhooks, hold their GitHub and Telegram credentials and become a target and a cost center.

## Options considered

1. **Central multi-tenant service** — one deployment to maintain and easy onboarding, but it concentrates every user's tokens and repository events, needs accounts, billing and abuse handling.
2. **One instance per user** — each user deploys a Worker in their own Cloudflare account (free plan) with their own D1 database, GitHub App and Telegram bot; nothing is shared.

## Decision

Every user runs their own Seluna instance in their own Cloudflare account. There is no central service, no shared database and no operator-held credential.

## Consequences

No central party can leak or lose a user's data, and the project has no running costs. Setup is the user's job (the `/setup` wizard keeps it short) and an update is a redeploy by each user; the daily release check only informs them.
