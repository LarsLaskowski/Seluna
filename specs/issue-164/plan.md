# Plan: Setup page texts without Cloudflare's and GitHub's menu paths

Source: Issue #164
Tier: trivial — UI wording of nine texts per language with a decision record; no behavior or control flow changes (`texts.ts` is in no security area; `pages.ts` stays unchanged).
Security areas touched: none

## Problem / root cause

Decision 0047's rule covers the guides only, so `src/setup/texts.ts` kept other services' menu paths and labels.
Decision: the setup texts follow the same rule (record 0049).

## Verified facts

| # | Claim | Evidence | Status |
| - | ----- | -------- | ------ |
| 1 | Lines 239, 262, 307, 369 (German 478, 502, 547, 610) quote menu paths | `src/setup/texts.ts` read | confirmed |
| 2 | Those four are all of them | Also 245/484, 340/580, 362/603, 373/614, 375/616: nine keys per language | refuted |
| 3 | `texts.test.ts` line 71 pins one | Lines 71, 75, 77, 125, 323, 329, 346, 409 pin eight; `pages.test.ts.snap` holds the affected pages in both languages | confirmed |
| 4 | The guides use plain words here | `docs/setup.md` 42, 95 | confirmed |
| 5 | Screenshot `07-github-review.png` (en, de) shows `githubReviewIntro`; no other screenshot shows a changed key | images read; 06 has no saved app, 09 shows `githubInstallIntro` (unchanged) | confirmed |

## Acceptance criteria

- AC1: No text of `TEXTS.en` or `TEXTS.de` contains, case-sensitively, `Developer settings`, `GitHub Apps`,
  `Install App`, `Create GitHub App`, `Variables and Secrets`, `Workers & Pages`, `Settings and Build`,
  `Settings und Build`, `Deploy command`, `Settings, then` or `Settings, dann`.
- AC2: The English texts read exactly (changed part only, the rest unchanged):
  - `githubReplaceHint`: "Creating a new app replaces the saved one. Afterwards, delete the old app on GitHub, in the settings of the account or organization that owns it."
  - `githubReviewIntro`: "… On GitHub, check the details and confirm the creation; GitHub then sends you back here. …"
  - `githubInstallManual`: "Install it on GitHub: open the app in the settings of your account or organization and install it there. Choosing Only select repositories …"
  - `resetText`: its sentence becomes "Afterwards, delete the old app on GitHub, in the settings of the account or organization that owns it."
  - `notConfiguredParagraphs[2]`: "In the Cloudflare dashboard, add a secret named SELUNA_SECRET with that string to this Worker. Or run: npx wrangler secret put SELUNA_SECRET"
  - `messenger-worker-secrets`: "… which Seluna cannot remove. Delete them from this Worker in the Cloudflare dashboard."
  - `migrations-missing`: "… have not run. In the Cloudflare dashboard, set the deploy command in this Worker's build settings to npm run deploy and retry the latest build, as the setup guide describes."
  - `telegram-token-malformed`, `telegram-token-rejected`: their ending becomes "replace the secret of this Worker in the Cloudflare dashboard."
- AC3: The German texts of the same keys translate AC2, in the guides' German terms (`Build-Einstellungen`,
  `Deploy-Befehl`, `bestätige das Erstellen`).
- AC4: `githubInstallIntro` and `githubInstallManual` still recommend _Only select repositories_ in both languages.
- AC5: `docs/assets/setup/{en,de}/07-github-review.png` show the new review intro.

## Tests per criterion

| AC | Test(s) | Test file |
| -- | ------- | --------- |
| AC1 | new: "AC1 texts quote no menu path or button label of Cloudflare or GitHub in either language" (over `textsOf`) | `src/setup/texts.test.ts` |
| AC2 | adapted: the English notices, GitHub step and status page tests; new: "AC2 texts word the English not-configured page without a menu path" | `src/setup/texts.test.ts` |
| AC3 | check: Reviewer reads the German snapshot entries in step 8 | `src/setup/__snapshots__/pages.test.ts.snap` |
| AC4 | existing, unchanged: the _Only select repositories_ test (lines 652–653) | `src/setup/pages.test.ts` |
| AC5 | manual: Dev recaptures both with the headless Chrome, made-up values as in 0047; Reviewer reads them in step 8 | — |

## Approach

Nine keys per language in `src/setup/texts.ts`; layout unchanged.

## Affected projects and types

| Project | Type / file | Change |
| ------- | ----------- | ------ |
| Worker | `src/setup/texts.ts` | nine texts per language |

## Signatures (for the Dev's skeleton)

No new or changed API.

## Test files

`src/setup/texts.test.ts` (Tester). The Tester renews only the snapshot entries in
`src/setup/__snapshots__/pages.test.ts.snap` of pages showing a changed text, and checks no other entry changed.
Code a unit test cannot cover: none.

## Areas

- `docs/areas/setup-wizard.md` (*Texts*): a bullet stating the rule of record 0049 with its exceptions; the
  not-configured bullet says "among the Worker's secrets in the Cloudflare dashboard"; record 0049 under
  *Related decisions*.
- `docs/areas/setup-login.md` 31–33: "in the Worker's build settings in the Cloudflare dashboard" for the path.
- `docs/areas/telegram-step.md` 91: "(the Worker's secrets in the Cloudflare dashboard)".
- `docs/areas/status-page.md` 166–167: "(in the settings of the account or organization that owns it)".

## Documentation updates

Dev, once green: the area documents above; `docs/CONTRIBUTING.md` (*Setup guides*): one sentence that the setup
pages' texts follow the same rule, linking *Setup wizard*, *Texts*; `CHANGELOG.md` *Unreleased*, *Changed*: the setup
pages describe Cloudflare's and GitHub's steps in plain words; the screenshots (AC5). Sweep: the guides,
troubleshooting and update guide quote no changed text; `docs/ARCHITECTURE.md` unaffected.

## Architecture check

No guarantee touched.

## Security considerations

- [x] No limits.
- [x] No exception reaches a text.

## Decision records

- `docs/decisions/0049-setup-page-texts-describe-other-services-in-plain-words.md` (Proposed)

## Out of scope / follow-ups

Commands and _Only select repositories_ stay (record 0049).
