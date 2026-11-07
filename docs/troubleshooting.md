# Troubleshooting

Find your symptom below. Each entry lists how to tell the causes apart and the fix. The setup guide is in [English](setup.md) and [Deutsch](setup.de.md).

Three places show what is wrong:

- **The status page**: sign in at `https://<worker>.<your-subdomain>.workers.dev/` (it leads to `/setup`). Its **Status** card shows where the bot token comes from (never its value), the chat, the GitHub App with its owner, the installations with what the app or an installation still lacks, and **Last delivery from GitHub:**.
- **GitHub's webhook deliveries**: the settings of your GitHub App on GitHub list each delivery GitHub sent to your instance and the status code the instance answered with ([GitHub's documentation](https://docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks/viewing-webhook-deliveries)).
- **The Workers build log**: the log of the latest build of your Worker in the Cloudflare dashboard ([Cloudflare's documentation](https://developers.cloudflare.com/workers/ci-cd/builds/)).

Do not turn on Workers traces or logs that record outbound requests to look for a cause: Seluna sends the Telegram bot token in the URL of its requests, so such traces record it. If you did, treat them as secret, or replace the token with `/revoke` at @BotFather.

- [The setup page says the database is missing its tables](#the-setup-page-says-the-database-is-missing-its-tables)
- [The setup page says SELUNA_SECRET is not set](#the-setup-page-says-seluna_secret-is-not-set)
- [Signing in is locked](#signing-in-is-locked)
- [The return from GitHub is refused](#the-return-from-github-is-refused)
- [No message arrives](#no-message-arrives)
- [GitHub's webhook deliveries show 401](#githubs-webhook-deliveries-show-401)
- [GitHub's webhook deliveries show 503](#githubs-webhook-deliveries-show-503)
- [The bot does not answer /start](#the-bot-does-not-answer-start)
- [The Telegram step finds no chat](#the-telegram-step-finds-no-chat)
- [The Telegram step says another program receives the bot's updates](#the-telegram-step-says-another-program-receives-the-bots-updates)
- [I changed the SELUNA_SECRET](#i-changed-the-seluna_secret)

## The setup page says the database is missing its tables

Signing in shows: _The database of this instance is missing its tables: the database migrations have not run._ (the notice goes on to name the fix).

**Cause**

- The deploy command of the Worker's build is not `npm run deploy`. The Deploy button sometimes sets `npx wrangler deploy`, which deploys the Worker without creating the database tables. `/health` still answers, because it reads no database.

**Fix**

1. In the Cloudflare dashboard open the build settings of your Worker ([Cloudflare's build configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)).
2. Set the deploy command to `npm run deploy` and save.
3. Retry the latest build. Its log shows the line `> wrangler d1 migrations apply DB --remote`.

## The setup page says SELUNA_SECRET is not set

Every page under `/setup` shows the heading **SELUNA_SECRET is not set** (HTTP status 503): _The setup cannot start because the Worker secret SELUNA_SECRET is missing or shorter than 32 characters._

**Cause**

- The Worker secret `SELUNA_SECRET` does not exist, or it has fewer than 32 characters.

**Fix**

1. Generate a random password of at least 32 characters with your password manager and save it there. (The page itself also names `openssl rand -hex 32`, which needs a command line.)
2. In the Cloudflare dashboard open the variables and secrets of your Worker and add or edit the secret `SELUNA_SECRET` with that value ([Cloudflare's documentation on secrets](https://developers.cloudflare.com/workers/configuration/secrets/)).
3. Reload the page.

## Signing in is locked

Signing in shows _That is not the SELUNA_SECRET of this instance._ for a wrong secret, and, after the fifth failed attempt, _Too many failed attempts. Signing in is locked for 15 minutes after the fifth failed attempt; try again later._ (HTTP status 429).

**Cause**

- Five wrong secrets, each within 15 minutes of the one before, lock signing in for the whole instance. While it is locked every attempt is rejected, the correct secret too. Further attempts do not extend the lock.

**Fix**

- Wait 15 minutes after the fifth failed attempt, then enter the correct `SELUNA_SECRET` from your password manager. If you do not have it any more, set a new one in the Cloudflare dashboard (see [I changed the SELUNA_SECRET](#i-changed-the-seluna_secret)).

## The return from GitHub is refused

After you select **Continue to GitHub**, create the app and come back, the setup page shows one of these notices instead of **The GitHub App is saved.**:

- _This return from GitHub does not belong to your current sign-in or is older than one hour, so nothing was saved. If GitHub created an app, delete it on GitHub and start again._
- _GitHub no longer accepts this return: the code was already used or is older than one hour._ It goes on: compare the App ID saved in the **GitHub App** step with the one GitHub shows in the app's settings. If they match, the app is saved. Otherwise delete the app on GitHub and start again.
- _This page needs the code and state GitHub sends back after creating the app. Start again from the GitHub App step._
- _GitHub created the app, but its answer could not be read, so nothing was saved._ or _GitHub created the app, but saving its credentials failed, so nothing was saved._ Delete the app on GitHub and start again.
- _This app does not belong to the account you chose in Seluna, so nothing was saved._ Delete it on GitHub and start again with the name of the account you are signed in to on GitHub.
- _GitHub could not be reached. Select Finish again in a moment; the return stays valid for one hour._

**Cause**

- The flow was not finished within one hour, you signed out of the setup page in between, or the same return was used twice.

**Fix**

1. On GitHub open the settings of your GitHub Apps, select the half-created app (named `seluna-` and your account) and delete it ([GitHub's documentation](https://docs.github.com/en/apps/maintaining-github-apps/deleting-a-github-app)).
2. In Seluna open the **GitHub App** step and start again. Finish within one hour and without signing out.

## No message arrives

You expected a Telegram message and none came. Check the causes in this order, the cheapest first.

1. **A draft pull request.** A draft pull request gives no message; the message comes when you mark it as ready for review. Open the pull request on GitHub: a draft is marked as a draft. (The exception is a leaked secret, reported whatever the pull request.)
2. **The repository is not in the installation.** With **Only select repositories** the app sees only the repositories you picked. On GitHub open the installation of the app and add the repository to it ([GitHub's documentation](https://docs.github.com/en/apps/using-github-apps/reviewing-and-modifying-installed-github-apps)). The status page's **Installations:** shows **selected repositories** for such an installation.
3. **The notification's switch is off.** On the start page check **Notify me about**. **New star on a repository** and **New fork of a repository** are off by default.
4. **Your own issues and comments.** An issue or comment you wrote yourself is left out, once the status page shows the **GitHub App owner:** (open the start page once after the installation). Comments of bots are left out too. A pull request you open yourself is reported.
5. **No bot token or chat saved.** If **Telegram bot token:** or **Telegram chat:** on the status page reads **None saved yet.**, notifications wait unsent until you set them up in the **Telegram chat** step; a token Telegram refuses shows as a notice in that step.
6. **A permission or event the app or an installation lacks.** The status page names it under **Missing on the app:** (follow **Add them in the app's settings on GitHub**), or marks an installation **missing:** (follow **Review and accept on GitHub**). Events the app does not have are not delivered.
7. **The hourly limit.** For issues, comments, stars, forks and, when someone else caused them, pull requests and CI failures, more than 20 of one kind in an hour are not reported one by one. You get one notice, _Notifications left out_, per kind and hour.
8. **Quiet hours.** During quiet hours the message arrives without sound, not later. Check your phone's Telegram notifications.

If none of these applies, look at **Last delivery from GitHub:** on the status page. **None received yet.** or an old time means GitHub's deliveries do not reach the instance or are refused: open the app's webhook deliveries on GitHub (see [401](#githubs-webhook-deliveries-show-401) and [503](#githubs-webhook-deliveries-show-503)). If there is no delivery at all for your action, the app is not installed on that repository (cause 2) or its webhook is not active.

## GitHub's webhook deliveries show 401

**Cause**

- The signature of the delivery does not match the instance's webhook secret. This happens when an old app is still installed after a new one was created: the instance now holds the new app's secret, and the old app signs with its own.

**Fix**

- Old app: on GitHub open the settings of your GitHub Apps, find the app that is not the one the **GitHub App** step shows (compare the App ID) and delete it.
- Then open the delivery in the app's webhook deliveries and redeliver it ([GitHub's documentation](https://docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks/redelivering-webhooks)). A delivery refused with 401 was not recorded, so a redelivery is processed.

## GitHub's webhook deliveries show 503

**Cause**

- The instance has no usable webhook secret yet: the GitHub App step is not finished, or only some of the three Worker secrets `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` and `GITHUB_WEBHOOK_SECRET` are set (the status page then says so), or the saved secret cannot be read because `SELUNA_SECRET` was changed, or the database failed for a moment.

**Fix**

- Finish the [GitHub App step](setup.md#6-create-the-github-app), or set all three Worker secrets if you use them, or follow [I changed the SELUNA_SECRET](#i-changed-the-seluna_secret). If the database failed, redeliver the delivery a moment later.

A delivery answered with 202 was accepted; 200 means that delivery was already recorded.

## The bot does not answer /start

**Cause**

- Seluna never answers in Telegram. It only sends messages: there is no route that Telegram calls, and no webhook is set for your bot. A bot that stays silent is working as designed.

**Fix**

- Nothing to fix. Use the **Telegram chat** step: select **Search for chats**, choose your chat, select **Send test message** and enter the code. If the test message arrives, the bot works.
- If the test message does not arrive, the notice _The test message could not be sent, so the chat was not saved._ tells you to check that the bot is still in the chat and not blocked. If Telegram refuses the token (_Telegram does not accept this token_), send `/mybots` to @BotFather, copy the bot's current token and enter it again.

## The Telegram step finds no chat

The step says: _No chat found. Send /start to your bot or add it to a group, then search again. Telegram keeps messages to the bot for 24 hours, and Seluna sees only the newest 100: if your bot receives many messages, send /start again just before you search._

**Cause**

- The bot has seen no message within the last 24 hours, or more than 100 newer messages from others pushed yours out of the list.

**Fix**

1. In Telegram open your bot and send `/start` (or add the bot to your group).
2. Directly afterwards select **Search for chats**.

## The Telegram step says another program receives the bot's updates

The step says: _Telegram does not hand the bot's chats to Seluna because another program receives its updates (a webhook, or a program that polls the bot)._

**Cause**

- The bot already has a webhook set, or another program reads its updates. Telegram then does not hand the chats to Seluna.

**Fix**

- Create a bot of its own for Seluna: send `/newbot` to @BotFather and use its token in the **Bot token** field. Or remove the webhook from the old bot. Seluna needs a bot that no other program uses.

## I changed the SELUNA_SECRET

Seluna can no longer read what it stored. The **GitHub App** step and the start page say _The saved credentials cannot be read_ (_Cannot be read with the current SELUNA_SECRET._ on the status card), and the **Telegram chat** step says the saved bot token cannot be read.

**Cause**

- `SELUNA_SECRET` is the source of the key that encrypts the stored credentials. A different secret gives a different key.

**Fix**, either:

- **Set the earlier secret again** in the variables and secrets of your Worker in the Cloudflare dashboard. Everything is readable again.
- Or, if you no longer have it, select **Reset and create the GitHub App again** on the start page. Seluna deletes the saved GitHub credentials, the installation tokens and the saved Telegram bot token; the Telegram chat and the settings are kept. Then create the GitHub App again in its step, enter the bot token again in the **Telegram chat** step, and afterwards delete the old app on GitHub.
