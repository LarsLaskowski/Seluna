# 0008: Delivery through a D1 outbox

- **Status:** Accepted
- **Date:** 2026-10-14
- **Area:** —
- **Source:** Issue #2
- **Supersedes:** —

## Context

Telegram can be slow, rate-limited or briefly unavailable, while GitHub expects a webhook answer within seconds and
redelivers on failure. A Worker has no background process; only cron triggers run later.

## Options considered

1. **Send to Telegram inside the webhook request** — simple, but a Telegram failure fails the webhook, GitHub redelivers and the user may be notified twice or not at all.
2. **Queues** — Cloudflare Queues give retries, but they are not part of the free plan.
3. **D1 outbox** — the webhook stores the message in the `outbox` table and answers; a send is attempted at once and the 10-minute cron retries what is still pending.

## Decision

A matched event is written to the D1 `outbox` table in the webhook request, deduplicated by `X-GitHub-Delivery`; the Telegram Bot API is called from the outbox, and the cron trigger retries unsent rows.

## Consequences

A message is delivered at least once and survives Telegram outages; a retry can delay a message by up to ten minutes. The outbox needs cleanup, which the same cron does.
