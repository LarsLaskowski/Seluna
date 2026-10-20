# Plan: Security alert rules

Source: Issue #17 | [spec.md](spec.md)
Status: Revised (1)
Tier: security — the secret scanning rule decides what of a delivery that may carry a leaked secret reaches the outbox, a message and the log (handling of secrets, `.squad/routing.md`, *Tiers*), and the change rewords a guarantee; in doubt the higher tier.
Security areas touched: Parsing of external input (`src/rules/security-alert.ts`, `src/rules/dependabot-alert.ts`, `src/rules/code-scanning-alert.ts`, `src/rules/secret-scanning-alert.ts` narrow new webhook payloads whose texts enter messages through `src/message.ts`); Encrypted credentials / "nothing secret is logged" (a secret scanning payload may carry a leaked secret, which must reach no row, message or log); `.squad/project.md` *Guarantees* (the draft guarantee is reworded, Product Manager's decision Q10). Not touched: Minimal GitHub App permissions (no new permission or event), Logging of external data (log fields unchanged).

## Problem / root cause

Feature: see [spec.md](spec.md) — no rule reads the three security alert events the app already receives.

## Verified facts

| # | Claim | Evidence | Status |
| - | ----- | -------- | ------ |
| 1 | The app already requests read access to Dependabot, code scanning and secret scanning alerts and subscribes to the three events | `src/github/manifest.ts:12-26` (`APP_PERMISSIONS`: `vulnerability_alerts`, `security_events`, `secret_scanning_alerts`; `APP_EVENTS`) | confirmed |
| 2 | The three switches exist, default on, and are stored as `rule_<id>` | `src/settings.ts:4-13` (`RULE_IDS`), `:34-46` (`DEFAULT_SETTINGS`); `docs/areas/storage.md:58` | confirmed |
| 3 | No rule handles the events yet; the registry ends with the CI rules | `src/rules/registry.ts:8-15` (comment "the security alert rules (#17) follow") | confirmed |
| 4 | Every rule runs on every delivery; a switched-off rule's notification is dropped and the decision is `disabled` | `src/rules/rule.ts` `runRules`; `src/webhook.ts:104-113` | confirmed |
| 5 | The formatter cleans, cuts (line 2/3: 256 code points) and escapes every line, leaves out an empty line 2/3, and shows the number only as a positive safe integer; a non-github.com URL gives no button | `src/message.ts:73-86` (`formatMessage`), `:60-71` (`buttonUrl`) | confirmed |
| 6 | Log fields of a delivery are status, decision, `action` and `repository` (pattern-checked); a sent row logs id and result — no payload text | `src/webhook.ts` `logFieldsOf`/`outcomeOf`; `docs/areas/notifications.md` *Log entries* | confirmed |
| 7 | German switch labels are Dependabot-Warnung, Code-Scanning-Warnung, Secret-Scanning-Warnung | `src/setup/texts.ts:413-415` | confirmed |
| 8 | Test helper `variant(payload, path, value)` (with `ABSENT`) builds payload variants from a fixture | `test/pull-request.ts` | confirmed |
| 9 | Decision 0027 is unreleased (added after `v0.3.0`); 0024 is released | `git ls-remote --tags origin` lists v0.1.0–v0.3.0; `git tag --contains` of 0027's adding commit is empty | confirmed |
| 10 | Field paths: `alert.number`, `alert.html_url`, `alert.security_advisory.{summary,severity}`, `alert.security_vulnerability.{severity,package.name}`, `alert.dependency.package.name` (Dependabot); `alert.rule.{id,description,severity,security_severity_level}`, top-level `ref` (code scanning); `alert.secret_type`, `alert.secret_type_display_name` (secret scanning) | to verify: read every path in the real deliveries of task 1 (Tester, step 5, before writing the first test); a missing path changes *Fields shown* in `spec.md` and the area document, reported to the Lead (source so far: GitHub webhook documentation (from memory)) | unverified |
| 11 | Code scanning `created`/`reopened` on the default branch carry `ref` `refs/heads/<default_branch>`; `appeared_in_branch` carries the branch it appeared in; a pull request alert carries `refs/pull/<n>/merge` | to verify: the real `code_scanning_alert` deliveries of task 1 (Tester, step 5); an `appeared_in_branch` or pull request sample may be missing — then the area document lists it as not verified (source so far: GitHub webhook documentation (from memory)) | unverified |
| 12 | The action lists of the three events (Dependabot: `auto_dismissed`, `auto_reopened`, `created`, `dismissed`, `fixed`, `reintroduced`, `reopened`, assignment; code scanning: `appeared_in_branch`, `closed_by_user`, `created`, `fixed`, `reopened`, `reopened_by_user`, assignment; secret scanning: `created`, `publicly_leaked`, `reopened`, `resolved`, `revoked`, `validated`, `assigned`, `unassigned`) | to verify: the real deliveries of task 1 show the actions they carry (Tester, step 5); irrelevant to correctness (every action but the reported ones sends nothing); the tests' action tables use these names (source so far: GitHub webhook documentation (from memory)) | unverified |
| 13 | Whether a secret scanning delivery carries `alert.secret` | to verify: the real `secret_scanning_alert` deliveries of task 1 (orchestrator, when anonymizing: the value is replaced by a fake but the field kept); AC7 holds either way (source so far: GitHub documentation is not explicit) | unverified |
| 14 | No real delivery of the three events exists in `test/fixtures/` or on the issue | `ls test/fixtures` (github, ping, pull_request, telegram, workflow_run); issue #17 has no comments; requested from the Product Manager (spec Q9) | confirmed |

## Acceptance criteria

The spec's AC1–AC12 ([spec.md](spec.md)).

## Tests per criterion

Fixture names are those of task 1; a test that needs a variant no real delivery covers builds it with `variant()`
from the nearest real one, never a hand-written payload.

| AC | Test(s) | Test file |
| -- | ------- | --------- |
| AC1 | `DEPENDABOT_ALERT reports the real created alert in English`; `DEPENDABOT_ALERT reports the real reopened alert with the same lines` | `src/rules/dependabot-alert.test.ts` |
| AC2 | `CODE_SCANNING_ALERT reports the real created alert on the default branch in English`; `CODE_SCANNING_ALERT reports a reopened alert on the default branch with the same lines` | `src/rules/code-scanning-alert.test.ts` |
| AC3 | `SECRET_SCANNING_ALERT reports the real created alert in English`; `SECRET_SCANNING_ALERT reports the real reopened alert with the same lines` | `src/rules/secret-scanning-alert.test.ts` |
| AC4 | `DEPENDABOT_ALERT reports in German`; `CODE_SCANNING_ALERT reports in German`; `SECRET_SCANNING_ALERT reports in German`; `MESSAGE_TEXTS holds the security alert titles in en and de` | the three rule test files; `src/i18n/messages.test.ts` |
| AC5 | `processWebhook decides disabled and stores no row for a created <event> with its switch off` (one case per event); `RULES holds the security alert rules after the CI rules in settings order` (adapted) | `src/webhook.test.ts`; `src/rules/registry.test.ts` |
| AC6 | `DEPENDABOT_ALERT reports nothing for the real dismissed alert`; `DEPENDABOT_ALERT reports nothing for the action <action>` (`fixed`, `auto_dismissed`, `auto_reopened`, `reintroduced`, an invented `some_new_action`); `CODE_SCANNING_ALERT reports nothing for the action <action>` (`fixed`, `closed_by_user`, `reopened_by_user`, `some_new_action`); `SECRET_SCANNING_ALERT reports nothing for the real resolved alert`; `SECRET_SCANNING_ALERT reports nothing for the action <action>` (`validated`, `publicly_leaked`, `revoked`, `some_new_action`). Action names other than those of the real deliveries are table cases from the documentation, not verified; assignment actions are covered by "any other action" and named only when a real delivery shows their exact name | the three rule test files |
| AC7 | `SECRET_SCANNING_ALERT returns the same notification with a secret in alert.secret, alert.resolution_comment and a location field`; `processWebhook stores the same outbox text and button URL and returns the same log fields for a secret scanning delivery with and without a secret` (secret: a fixed 40-character fake, `SELUNA_TEST_` followed by 28 random letters and digits, matching no provider's secret pattern so push protection does not trip; asserted absent as a substring of the text, the button URL and every log field); `SECRET_SCANNING_ALERT returns the same notification when every string outside action and the five read fields of the real created delivery is the secret` (walks the fixture and replaces every string leaf outside `action`, `alert.number`, `alert.html_url`, `alert.secret_type`, `alert.secret_type_display_name`, `repository.full_name`: pins the allow-list itself) | `src/rules/secret-scanning-alert.test.ts`; `src/webhook.test.ts` |
| AC8 | per rule: `<RULE> reports nothing when <field> is <value>` (table: `alert` missing / an array; `alert.number` 0, 1.5, 2^53, a string; `alert.html_url` missing / a number; `repository.full_name` missing); `DEPENDABOT_ALERT reports nothing without alert.security_advisory`; `CODE_SCANNING_ALERT reports nothing without alert.rule, ref or repository.default_branch`; `SECRET_SCANNING_ALERT reports nothing without alert.secret_type`; per rule: `<RULE> reports nothing for the real delivery of another alert event under its event name` and `<RULE> reports nothing for its payload under another event name` | the three rule test files |
| AC9 | `CODE_SCANNING_ALERT reports the alert that appeared in the default branch`; `CODE_SCANNING_ALERT reports nothing for <action> with ref <ref>` (actions `created`, `reopened`, `appeared_in_branch` × refs `refs/pull/1/merge`, `refs/heads/feature`, `refs/tags/v1`, `""`, absent, `main` without `refs/heads/`) ; `CODE_SCANNING_ALERT reports nothing for the real pull request alert` (when that sample exists) | `src/rules/code-scanning-alert.test.ts` |
| AC10 | `DEPENDABOT_ALERT shows <line> when <fields> are missing` (severity falls back to `security_vulnerability.severity` when `security_advisory.severity` is absent, `null`, a number, `""` or `"  "`; package to `security_vulnerability.package.name` when `dependency.package.name` is absent, `null` or `""`; package alone; severity alone; no line 3; no line 2); `CODE_SCANNING_ALERT falls back to rule.severity when security_severity_level is <value>` (absent, `null`, `""`); `CODE_SCANNING_ALERT shows the rule id alone without either severity`; `CODE_SCANNING_ALERT has no line 2 without rule.description`; `SECRET_SCANNING_ALERT has no line 2 without a display name`; `<RULE> shows an unknown severity as sent`; `joinContext joins the non-blank parts with " · "` (table) ; `stringAt returns undefined for a missing, null or non-string field`; `firstText returns the first non-blank string` (table: first `""`, `"  "`, absent → the second) | the three rule test files; `src/rules/security-alert.test.ts` |
| AC11 | `processWebhook escapes an advisory summary with <, & and a line break and keeps it on one line` | `src/webhook.test.ts` |
| AC12 | `SECRET_SCANNING_ALERT returns the same notification when the payload carries a ref and a draft pull_request` | `src/rules/secret-scanning-alert.test.ts` |

## Approach

1. **Fixtures first (task 1, orchestrator).** The real deliveries the Product Manager supplies become
   `test/fixtures/<event>/<action>.json` as `.squad/project.md` (*Fixtures from real deliveries*) says, plus a
   `README.md` per folder naming the variants covered and those missing (pattern: `test/fixtures/workflow_run/README.md`).
   The Product Manager creates the secret scanning sample with a purpose-made secret, revoked right away; in the
   fixture the secret value, wherever it occurs, is replaced by a fake `SELUNA_TEST_…` that matches no provider's
   pattern (field kept), and the original value is one of the strings of the leak grep of *Fixtures from real
   deliveries* (step 2). Wanted: `dependabot_alert/created.json`, `reopened.json`, `dismissed.json`; `code_scanning_alert/created.json`
   (default branch), `created-pull-request.json`, `appeared_in_branch.json`, `reopened.json`, `fixed.json` or
   `closed_by_user.json`; `secret_scanning_alert/created.json`, `reopened.json`, `resolved.json`. **Until they exist,
   step 4 (skeleton) may run, step 5 does not start.** If the Product Manager cannot supply some, only the Product
   Manager may confirm building those tests on variants of a supplied delivery or on GitHub's documented example payloads
   (the risk then goes into decision 0028); the Lead never substitutes a hand-built payload. Minimum to start: one
   `created` per event.
2. **Shared narrowing** `src/rules/security-alert.ts`: `securityAlert()` checks the event name and the action set, then
   narrows `alert` (record), `alert.number` (positive safe integer), `alert.html_url` (string) and
   `repository.full_name` (string); `stringAt()` reads a string at a path; `firstText()` returns the first value that is
   a string with a non-space character (the fallback rule of *Fields shown*: missing, `null`, not a string or blank);
   `joinContext()` joins the non-blank parts
   with ` · `. Reuses `isRecord`/`recordField`/`stringField` from `src/rules/pull-request.ts`.
3. **Three rules**, one file each, exporting a `Rule` with the switch id:
   - `DEPENDABOT_ALERT` (`dependabot_alert`; actions `created`, `reopened`): requires `alert.security_advisory` as a
     record; line 2 `security_advisory.summary`; line 3 `joinContext([severity, package])`, each through `firstText` with the fallbacks of
     *Fields shown*.
   - `CODE_SCANNING_ALERT` (`code_scanning_alert`; actions `created`, `reopened`, `appeared_in_branch`): requires
     `alert.rule` as a record and `ref`, `repository.default_branch` as strings, and `ref === "refs/heads/" +
     default_branch`; line 2 `rule.description`; line 3 `joinContext([firstText([security_severity_level, severity]), rule.id])`.
   - `SECRET_SCANNING_ALERT` (`secret_scanning_alert`; actions `created`, `reopened`): requires `alert.secret_type` as a
     string; line 2 `secret_type_display_name`; line 3 `secret_type`. It reads no other `alert` field: the allow-list
     of decision 0028 is the whole protection, so no code path touches `alert.secret`, `resolution_comment` or
     locations.
   No rule sets `draftCheck`.
4. **Texts**: `dependabotAlert`, `codeScanningAlert`, `secretScanningAlert` in `MessageTexts`, `EN`, `DE`.
5. **Registry**: append the three rules after `CI_FAILED_PULL_REQUEST` in settings order; drop the "(#17) follow" note.
6. **Documentation** (below).

## Options considered

- Code scanning refs: every ref / non-pull-request refs / default branch only — settled by the Product Manager (Q1,
  decision 0028), default branch only with `appeared_in_branch`.
- Secret scanning and drafts: report regardless and reword the guarantee / keep the guarantee — settled by the Product
  Manager (Q10, decision 0028).
- Secret protection: an allow-list of read fields (chosen) / scrubbing the secret from texts (needs the secret in the
  rule; misses parts and encodings) — decision 0028.
- Missing shown fields: shorten the line (chosen) / send nothing, as the pull request rules do — decision 0028: losing a
  security alert over a missing text is worse.
- Code layout: three rule files over one shared module (chosen, the pattern of the CI rules with `workflow-run.ts`) /
  one generic table-driven rule factory like `pullRequestRule` — the three events differ in required fields, line
  composition and the ref check, so a factory would need per-event callbacks for almost everything.

## Affected projects and types

| Project | Type / file | Change |
| ------- | ----------- | ------ |
| Worker | `src/rules/security-alert.ts` | new: shared narrowing |
| Worker | `src/rules/dependabot-alert.ts`, `code-scanning-alert.ts`, `secret-scanning-alert.ts` | new: the three rules |
| Worker | `src/rules/registry.ts` | append the three rules, update the comment |
| Worker | `src/i18n/messages.ts`, `en.ts`, `de.ts` | three title keys |
| Tests | `test/fixtures/dependabot_alert/`, `code_scanning_alert/`, `secret_scanning_alert/` | new fixtures + `README.md` (orchestrator) |

## Signatures (for the Dev's skeleton)

`src/rules/security-alert.ts`:

```ts
/** The three security alert events. */
export type SecurityAlertEvent = "dependabot_alert" | "code_scanning_alert" | "secret_scanning_alert";

/** The fields every reported security alert delivery carries, narrowed. */
export interface SecurityAlertFields {
  /** `repository.full_name`. */
  readonly repository: string;
  /** `repository` itself, for event-specific fields such as `default_branch`. */
  readonly repositoryRecord: Readonly<Record<string, unknown>>;
  /** `alert.number`, a whole number from 1 to 2^53 - 1. */
  readonly number: number;
  /** `alert.html_url`. */
  readonly url: string;
  /** `alert` itself, for the event-specific fields. */
  readonly alert: Readonly<Record<string, unknown>>;
}

/** The common fields of a delivery of `expected` whose `action` is in `actions`; otherwise `undefined`. */
export function securityAlert(
  event: string,
  payload: WebhookPayload,
  expected: SecurityAlertEvent,
  actions: ReadonlySet<string>,
): SecurityAlertFields | undefined;

/** The string at `path` below `record`; `undefined` when a step is missing, not an object, or the value not a string. */
export function stringAt(record: Readonly<Record<string, unknown>>, path: readonly string[]): string | undefined;

/** The first of `values` that is a string with a non-space character, trimmed; `undefined` when none is. */
export function firstText(values: readonly (string | undefined)[]): string | undefined;

/** The parts that are strings with a non-space character, trimmed, joined with ` · `; `""` when none is. */
export function joinContext(parts: readonly (string | undefined)[]): string;
```

`src/rules/dependabot-alert.ts`: `export const DEPENDABOT_ALERT: Rule;`
`src/rules/code-scanning-alert.ts`: `export const CODE_SCANNING_ALERT: Rule;`
`src/rules/secret-scanning-alert.ts`: `export const SECRET_SCANNING_ALERT: Rule;`

`src/i18n/messages.ts`, `MessageTexts` gains:

```ts
  /** Title of a Dependabot alert. */
  readonly dependabotAlert: string;
  /** Title of a code scanning alert. */
  readonly codeScanningAlert: string;
  /** Title of a secret scanning alert. */
  readonly secretScanningAlert: string;
```

`EN`: `"Dependabot alert"`, `"Code scanning alert"`, `"Secret scanning alert"`; `DE`: `"Dependabot-Warnung"`,
`"Code-Scanning-Warnung"`, `"Secret-Scanning-Warnung"`. Rewritten by the skeleton: `src/rules/registry.ts` (final once the
three constants exist), `src/i18n/en.ts`, `src/i18n/de.ts` (final: the texts are fixed here).

## Test files

- `src/rules/security-alert.test.ts`, `src/rules/dependabot-alert.test.ts`, `src/rules/code-scanning-alert.test.ts`,
  `src/rules/secret-scanning-alert.test.ts` (new); `src/i18n/messages.test.ts`, `src/webhook.test.ts`,
  `src/rules/registry.test.ts` (extended).
- Existing test code that calls a changed signature: `src/rules/registry.test.ts` pins `RULES` exactly — the Tester
  adapts it in step 5 (it fails on the skeleton's registry as intended). `MessageTexts` gains keys: any test that builds
  a full `MessageTexts` object literal would fail the type check — none does today (`messages.test.ts` reads
  `MESSAGE_TEXTS`); the Dev confirms with *Type check* on the skeleton.
- Files no unit test can cover: none.

## Areas

- `docs/areas/notifications.md` (Dev): new subsection `#### Security alert rules` under *Rules* (anchor
  `security-alert-rules`, linked from decision 0028), replacing "the rules for security alerts (#17) follow": the table
  of the three switch ids with event, reported actions, English and German titles; *Fields shown* as confirmed by the
  fixtures; required fields and the shape check; the code scanning default-branch rule; the secret allow-list and "no
  part of a secret reaches a row, message or log"; secret scanning alerts reported whatever their source, outside the
  draft guarantee; the variants not verified against real deliveries. *Languages*: the three titles. *Related
  decisions*: 0028. The *Draft lookup* sentence "This is the one exception to 'a draft pull request triggers no
  notification'" becomes "This is one of the two exceptions to … (the other: a secret scanning alert, [Security alert
  rules](#security-alert-rules))".

## Documentation updates

Sweep done: `grep -i draft` and `grep -i "security alert\|#17"` over `README.md`, `SECURITY.md`, `docs/`, `.squad/project.md`.

- `docs/ARCHITECTURE.md` (Lead, **done in this plan step**): the opening paragraph keeps "Draft pull requests trigger
  nothing" and names two exceptions: the CI failure marked _draft status unknown_ (0027) and a secret scanning alert,
  reported whatever its source (0028); step 3 of *Webhook to Telegram* names the security alert rules.
- `.squad/project.md` (Dev): *Guarantees*, first bullet (line 80) becomes exactly: "A draft pull request triggers no
  notification; the exceptions are a CI failure in a pull request whose draft state could not be read (failure or no
  answer within 8 seconds), reported marked _draft status unknown_ — [decision 0027](../docs/decisions/0027-ci-failure-rules-and-the-draft-lookup.md),
  and a secret scanning alert, which is reported whatever its source — [decision 0028](../docs/decisions/0028-security-alert-rules.md)."
- `docs/areas/notifications.md` (Dev): *Areas* above; also line 62 and the registry comment wording.
- `README.md` (Dev): rule table row "A Dependabot, code scanning or secret scanning alert is opened" → "available"
  with "(code scanning: on the default branch)"; the paragraph after the table names line 3 of alerts and that a secret
  is never shown; line 44 "Draft pull requests trigger nothing; …" keeps its sentence and adds "A leaked secret is
  reported even when it was pushed to a draft pull request."; line 24 "Drafts stay quiet." → "Drafts stay quiet, except
  for a leaked secret.";
  *Status* sentence "can already notify you about pull requests and failed CI runs" adds security alerts; the note
  "The switches for notifications that arrive in a later release …" stays (the update notice switch still waits for 0.5.0).
- `CHANGELOG.md` (Dev): `## [Unreleased]` / `### Added`: notifications for new and reopened Dependabot, code scanning
  (default branch) and secret scanning alerts, each with its existing switch; the secret itself never appears.
- `test/fixtures/<event>/README.md` (orchestrator, with the fixtures).
- Not changed: `AGENTS.md`'s "draft pull requests trigger nothing" (a squad/instruction file a product PR may not
  touch; follow-up below), `docs/areas/setup-wizard.md`, `docs/areas/storage.md` (switches, permissions and events
  already described), `SECURITY.md` (no draft or alert statement).

## Architecture check

- Rules stay pure (no I/O, no clock): the three rules read only the payload and the settings; no draft check, no API
  call.
- "A draft pull request triggers no notification" gains a second named exception with the Product Manager (Q10): a
  secret scanning alert is reported whatever its source. Dependabot alerts stay under the guarantee (per GitHub's
  documentation they concern the default branch; unverified, fact 10's re-check), and code scanning never reports a pull request ref (E9). `docs/ARCHITECTURE.md` (done) and `.squad/project.md` (Dev) carry the new wording, linked to
  decision 0028.
- Invalid signature, once per delivery, outbox before delivery, own Cloudflare account, encrypted credentials:
  untouched (processing, storage and delivery are not changed).

## Security considerations

- [ ] Limits: the existing ones of `src/message.ts` — 256 code points per line, counted on the decoded text after
  cleaning, before escaping; the body limit of 1 MiB is counted on raw bytes before decoding (`src/body.ts`). No new
  limit.
- [ ] Exceptions reaching a user: none — the rules return `undefined` on any unexpected shape and never throw (no
  `JSON`, no `URL` parsing in them); a throw would end as the fixed 503 `unavailable` of `processWebhook`.
- Secret: fakes in fixtures and tests are `SELUNA_TEST_…` strings that match no provider's secret pattern (push
  protection); the original secret of the raw delivery is grepped for in the new fixtures (*Fixtures from real
  deliveries*, step 2), and it was created for the purpose and revoked.
- Secret: the secret scanning rule reads exactly `alert.number`, `alert.html_url`, `alert.secret_type`,
  `alert.secret_type_display_name` and `repository.full_name`; the Reviewer and Security check that no other `alert`
  field is read in `secret-scanning-alert.ts` or passed on through `SecurityAlertFields.alert` to anything that formats
  it. AC7 pins it end to end (outbox text, button URL, log fields) and pins the allow-list itself (every other string
  leaf of the real delivery replaced by the secret gives the same notification).
- Attacker-chosen text: advisory summaries (GitHub Advisory Database), rule descriptions (an analysis tool; a SARIF
  upload needs write access), package names (a manifest merged into the default branch), custom secret pattern names
  (an administrator) — all cleaned and escaped by `formatMessage`; the button only for `https://github.com` URLs.
- The event header is not signed: each rule requires its event's discriminating fields (E2, AC8).

## Decision records

- `docs/decisions/0028-security-alert-rules.md` (Proposed) — code scanning on the default branch only (Q1), secret
  scanning outside the draft guarantee (Q10), the field allow-list against leaking the secret, the Dependabot title (Q2),
  optional shown fields; indexed in `docs/decisions/README.md`.

## Challenge

Plan challenge by the Devil's Advocate, one round.

1. Major — the plan rests on GitHub's documentation from memory, not on real deliveries (facts 10–13). Accepted: the
   plan is held until the real deliveries exist (`RESULT: ESCALATE` on Q9 with the minimum set). When the fixtures
   exist, before step 4, the Lead re-checks against them and revises in place: fact 10 and *Fields shown* in `spec.md`
   (every path, which of a pair is present, whether `security_severity_level` is in the webhook) and the signatures if a
   field moves; fact 11 and AC9's ref check (the value of `ref` for `created` on the default branch, for
   `appeared_in_branch` and for a pull request alert); fact 12 and the action tables of AC6 (exact names, assignment
   actions); fact 13 and AC7 (whether `alert.secret` is present, where else the secret occurs); the *Variants not
   available* of the fixture READMEs and the area document. Variants the Product Manager cannot supply stay
   `unverified` and are tested only as variants of a real delivery. No payload is invented.
2. Minor — fallbacks must also trigger on a blank first value. Accepted: *Fields shown* and E3 say "missing, `null`,
   not a string or blank"; new helper `firstText`; AC10 has a case with `""` (and `"  "`) per fallback.
3. Minor — `README.md:24` "Drafts stay quiet." Accepted: in *Documentation updates*, reworded together with line 44
   and the guarantee wording.
4. Minor — assignment action names are inconsistent. Accepted: AC6's tables no longer name assignment actions; an
   invented `some_new_action` case covers "any other action", and exact names come from the real deliveries (fact 12).

## Security review

Security approved the plan with three notes; all taken.

1. The wording "no pull request or CI notification" would also take Dependabot and code scanning out of the
   guarantee, contradicting E9. Taken: the guarantee keeps "A draft pull request triggers no notification" and names
   two exceptions, the CI failure marked _draft status unknown_ (0027) and a secret scanning alert, reported whatever
   its source (0028). Applied to `docs/ARCHITECTURE.md` (done), decision 0028 and `spec.md` (S11, Q10); planned for
   `.squad/project.md`, the *Draft lookup* sentence of `notifications.md`, `README.md` and the AGENTS.md follow-up.
   E9 stands.
2. A test that pins the allow-list itself. Taken: AC7 and E5 are extended; the test walks the real `created` fixture
   and replaces every string leaf outside `action` and the five read fields with the secret.
3. Fixtures with a secret. Taken: the Product Manager creates the sample with a purpose-made secret, revoked right
   away; the original value joins the leak grep; fakes are `SELUNA_TEST_…`, also the 40-character value of AC7.

## Out of scope / follow-ups

- Follow-up issue (squad-maintenance, label `squad`, this repository): title "[Squad] Reword the draft statement in
  AGENTS.md after decision 0028"; body: "AGENTS.md and .github/copilot-instructions.md (*What this project is*) say
  'draft pull requests trigger nothing'. Since decision 0028 (issue #17), a secret scanning alert is reported whatever its
  source, a draft pull request's branch or text included: 'A draft pull request triggers no notification; the exceptions
  are the CI failure marked draft status unknown (0027) and a secret scanning alert, which is reported whatever its
  source (0028).'
  A product PR may not edit these files, so a squad-maintenance PR should align the wording with docs/ARCHITECTURE.md."
- Grouping many alerts into one message; Dependabot `reintroduced`/`auto_reopened` and code scanning
  `reopened_by_user`; severity filters — spec *Out of scope*.
