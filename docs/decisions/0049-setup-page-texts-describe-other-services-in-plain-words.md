# 0049: Setup page texts describe other services' steps in plain words

- **Status:** Proposed
- **Date:** 2026-11-07
- **Area:** Setup wizard
- **Source:** Issue #164
- **Supersedes:** —

## Context

[Decision 0047](0047-setup-guide-screenshots-of-selunas-own-pages.md) has the setup guides, the troubleshooting page
and the update guide describe Cloudflare's, GitHub's and Telegram's steps in plain words, without their menu paths and
labels, because those pages change faster than the guides are checked. The setup pages themselves
(`src/setup/texts.ts`) still quoted such paths and labels in nine texts per language: the Worker's
_Settings_ → _Variables and Secrets_, _Workers & Pages_ → _Settings_ → _Build_ and the _Deploy command_, GitHub's
_Developer settings_ → _GitHub Apps_, _Install App_ and _Create GitHub App_. A setup page is product code: its text
changes only with a release and its tests, so a renamed menu leaves an instance with a wrong instruction until the
owner updates.

## Options considered

1. **Plain words in the setup texts, as in the guides** — what to do and where (the Worker's secrets or build
   settings in the Cloudflare dashboard, the settings of the account that owns the app on GitHub), no menu path or
   label of another service; the guides keep the links to those services' documentation. One rule for every text a
   reader follows. Chosen.
2. **Keep the menu paths in the setup texts** — easiest to follow while they are right, but they age with the other
   service's pages, and only a release corrects them.
3. **Plain words plus a link from the page to the other service's documentation** — the texts are plain strings that
   `src/setup/pages.ts` escapes; links would change the page markup of several pages for what the setup guide, which
   the texts already name, carries.
4. **Also replace _Only select repositories_** — it is a GitHub label too, but it names the one installation choice
   whose risk the README explains, and the guides, the README and the GitHub App step's recommendation (with its
   tests and screenshot) quote it as Seluna's own recommendation. Not chosen.

## Decision

Option 1: the setup texts describe other services' steps in plain words and quote no menu path or button label of
them; Seluna's own labels, the recommended installation choice _Only select repositories_ and commands (the bot
commands to @BotFather, `openssl` and `wrangler`) stay. The rule is in [Setup wizard](../areas/setup-wizard.md#texts).

## Consequences

- A renamed menu at Cloudflare or GitHub leaves the setup pages correct; the owner finds the place from the
  description, or from the setup guide's link to that service's documentation.
- The plain description is less exact than a path on the day it is written.
- _Only select repositories_ still ties two texts to GitHub's label; renaming it at GitHub needs a text change.
- The review page's screenshot in the guides changes with its text.
