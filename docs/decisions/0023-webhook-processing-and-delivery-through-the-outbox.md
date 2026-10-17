# 0023: Webhook processing, message format and delivery through the outbox

- **Status:** Accepted
- **Date:** 2026-10-17
- **Area:** Notifications
- **Source:** Issue #12
- **Supersedes:** —

## Context

Until issue #12, `POST /webhook` answered 202 to every validly signed delivery and did nothing else. Issue #12 asks
for the pipeline behind the signature check: deduplicate by `X-GitHub-Delivery`, run the enabled rules, write each
message to the D1 `outbox`, answer 202 and send through `ctx.waitUntil`; a fixed three-line Telegram message in
HTML with an "Open on GitHub" button, its texts in English and German; one retry within the request on Telegram's
429; and `meta` `last_delivery` kept current. The guarantees "a delivery is processed once" and "a matched event is
written to the outbox before delivery is attempted" ([decision 0008](0008-delivery-through-a-d1-outbox.md)) rest on
this pipeline. The schema is fixed since issue #7 ([decision 0014](0014-d1-schema-and-data-access.md)): `outbox`
holds `text`, `button_url` and `silent`, but no button label and no language. No rule exists yet: the pull request
rules (#13), CI rules (#16) and security alert rules (#17) each depend on this issue, and a rule is tested only
with a real payload of its event, of which the repository holds none. A Worker's `waitUntil` work is cut off about
30 seconds after the response (Cloudflare's documentation; not measured here).

## Options considered

How far this change goes:

1. **The pipeline, the rule interface, the message format, the languages and the delivery, with an empty rule
   list** — every part is tested with rules defined in the tests; the rule issues add one file each and their real
   fixtures. Chosen.
2. **The same plus the pull request rules of #13** — the first notification would arrive with this change, but
   without a real `pull_request` payload the rules could only be tested against invented ones, and #13's scope
   would move here.

How a redelivery is kept from producing a second message:

3. **A read of `deliveries` first, then one D1 batch that inserts the delivery (a plain insert, which fails on a
   known id), its `outbox` rows and `last_delivery`; a failed batch is read again to tell a duplicate from a
   database error** — a batch is one transaction, so either the delivery and all its messages are stored or
   nothing is, and two concurrent requests with one id store one set of rows. Chosen.
4. **`INSERT OR IGNORE` of the delivery, then separate inserts of the messages** — a failure between the two
   statements leaves a recorded delivery without its message, and the redelivery is then ignored: a lost message.
5. **Only the read of `deliveries` first** — two concurrent deliveries of one id both pass it and send twice.

Where the button label comes from:

6. **From the language setting at the time of sending** — no schema change; a row that is still pending when the
   owner switches the language gets a button in the new language beside a text in the old one. Chosen.
7. **A new column for the label (a second migration)** — exact, but a migration that every copy applies for a
   cosmetic mismatch of pending rows.

When the message text is rendered:

8. **When the row is written, as the Telegram HTML text in `outbox.text`** — what the storage area already says the
   column holds ("the message text as sent"); the sender, and later the cron, need no rule or payload. Chosen.
9. **When it is sent, from a stored notification** — a new column and a second place that interprets rule output.

What a 429 answer does:

10. **Wait `retry_after` and send once more when it is a whole number of 1 to 5 seconds; otherwise, and when the
    second answer fails too, leave the row pending** — two requests of at most 10 seconds each plus the wait stay
    inside the `waitUntil` window. Chosen.
11. **Wait any `retry_after`** — a wait beyond the window is cut off with nothing gained.
12. **No retry within the request** — what the issue asks against; the cron would delay the message by up to ten
    minutes.

What a validly signed delivery that cannot be processed gets:

13. **400 with nothing stored, when the delivery id or event header is missing or malformed or the body is not a
    JSON object (also inside a form-encoded `payload` field)** — only GitHub can sign it, so it is a fault, and
    nothing is deduplicated that was never processed. Chosen.
14. **202 and a recorded delivery** — hides the fault in GitHub's delivery log.

Where the pipeline sits:

15. **A module of its own that the router calls after the signature check, injected into the route dependencies**
    — the router keeps its body limit, secret and signature rules and their tests; the pipeline is tested against
    the real D1 of the test pool. Chosen.
16. **Inside the router** — every route test would need D1 and fresh delivery ids.

## Decision

A validly signed delivery is processed by its own module: a known delivery id answers 200 with no other effect; a
new one is stored in one D1 batch together with the outbox rows of the enabled rules' messages and `last_delivery`,
answered 202, and its rows are sent in `waitUntil`, with one retry after a 429 whose `retry_after` is 1 to 5 seconds.
Rules are pure functions of event name, payload and settings that return a notification or nothing, the rule list is
empty until the rule issues add to it, and the message is rendered as escaped Telegram HTML when it is written, its
button label taken from the language at sending. The rules are in [`areas/notifications.md`](../areas/notifications.md).

## Consequences

- The status page shows the time of the last delivery from GitHub; no notification is sent until a rule exists
  (#13).
- Every new delivery adds a `deliveries` row and a `meta` write; the cleanup of old rows is the cron's (#18), which
  also resends the rows this change leaves pending, through the same sending code.
- A delivery answered 400 or 503 stores nothing and GitHub does not redeliver it on its own; a manual redelivery
  works because its id is not recorded. This is accepted: "never lose a message" covers the rows in the outbox.
- The signature covers the body only, not the `X-GitHub-Delivery` and `X-GitHub-Event` headers: a replayed signed
  body with a new delivery id yields a second message, and a changed event header feeds the payload to the rules of
  another event. This is inherent to GitHub's design; the rules check that the payload's shape matches the event.
- Rules are not isolated from each other: a rule or the formatter that throws makes the whole delivery 503 with
  nothing stored, so a defect in one rule is visible in GitHub's delivery list and can be redelivered once fixed,
  instead of silently dropping that rule's message while the others are sent.
- A row is sent at least once: when Telegram accepted a message but marking the row sent fails, the cron sends it
  again (as decision 0008 accepts).
- Without a usable bot token or chat a row stays pending without counting an attempt, so a message written before
  the setup was finished is delivered once it is.
- The Worker reads one more value from Telegram: the `retry_after` of a 429 answer, read bounded and narrowed to a
  whole number. The input it takes from Telegram stays the `getUpdates` answer of the setup wizard and the answer
  status of `sendMessage`, now with that value.
- Residual risk: the HTML parse mode, the inline button and the 429 answer are built from the Bot API reference
  (like the client of [decision 0016](0016-telegram-chat-in-the-setup-wizard.md)); a deviation fails closed (the row
  stays pending), and the first real notification of #13 is the live check against the real API.
- The `waitUntil` window of about 30 seconds is taken from Cloudflare's documentation, not measured; a send cut off
  by it leaves its row pending.
- The rule issues add their texts to `src/i18n/en.ts` and `src/i18n/de.ts`; once the two tables are large enough to
  count as duplicated code in the CI analysis, they need the treatment of
  [decision 0019](0019-language-tables-excluded-from-duplication.md), with a record of their own.
