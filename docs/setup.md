# Setup

How to deploy your own Seluna instance. A fuller guide follows in a later version.

## Before you deploy

- A Cloudflare account and a GitHub account.
- The token of your Telegram bot: in Telegram, send `/newbot` to [@BotFather](https://t.me/BotFather) and copy the token it returns. You enter it in the setup wizard after the deployment.
- A `SELUNA_SECRET`: a random string of at least 32 characters, for example from a password manager or `openssl rand -hex 32`. It is the password of the `/setup` page and the source of the key that encrypts the stored credentials. Keep it: changing it later means running the setup again.

## Deploy

1. Select the **Deploy to Cloudflare** button in the [README](../README.md) and connect your GitHub account.
2. The button creates an independent copy of the repository in your GitHub account (not a fork), creates the D1 database, asks for `SELUNA_SECRET`, then builds and deploys the Worker. If the form lets you edit the deploy command, set it to `npm run deploy`.
3. In the Cloudflare dashboard open **Workers & Pages**, your Worker, **Settings** and **Build**, and check that the **Deploy command** is `npm run deploy`. The button may set `npx wrangler deploy` instead, which deploys the Worker without creating the database tables; signing in on `/setup` then shows _The database of this instance is missing its tables_. If it reads anything else, change it to `npm run deploy` and retry the latest build. The build log of a correct deploy shows the line `> wrangler d1 migrations apply DB --remote`.
4. Open `https://<worker>.<your-subdomain>.workers.dev/health`. It answers with the version; it does not check the database.

## Updates

Every push to `main` of your copy builds and deploys it; with the deploy command `npm run deploy` it applies the database migrations first. To apply a new release to your copy, run the update workflow in GitHub's web interface; [Update](update.md) explains how, and what to do about conflicts and permissions.

## Next steps

Open `https://<worker>.<your-subdomain>.workers.dev/` (it leads to `/setup`) and sign in with your `SELUNA_SECRET`. Then open the step **Telegram chat**. First enter the token of your bot in the field **Bot token** and select **Save token**: Seluna checks the token with Telegram, saves it encrypted and does not show it again. Later you can select **Change token** to enter another one or **Remove token** to delete it; notifications that arrive while no token is saved wait unsent. Optionally, the Worker secret `TELEGRAM_BOT_TOKEN` sets the token by hand and takes precedence over a saved one; while it is set, the step shows no token form (delete the secret to enter the token in the step). Next send `/start` to your bot (or add the bot to a group), search for chats, choose your own chat and type the code of the test message Seluna sends to it into the setup page. Seluna saves the chat once the code matches. Optionally, the Worker secret `TELEGRAM_CHAT_ID` sets the chat by hand and takes precedence over the chosen one.

Then open the step **GitHub App**. Choose your personal account or an organization, enter its name and select **Next**; Seluna shows what it will ask for (a private GitHub App with read-only access to Actions, Contents, Issues, Pull requests, Dependabot alerts, Code scanning alerts, Secret scanning alerts and Metadata, and the matching events: pull requests, workflow runs, the three kinds of security alerts, issues, issue comments, forks and stars). Select **Continue to GitHub**, check the details there (you can change the app's name) and select **Create GitHub App**. GitHub sends you back to the setup page: select **Finish** and Seluna saves the app's credentials encrypted. Do this within one hour and while you are still signed in to the setup page. Finally follow the link to install the app on your account or organization and choose **Only select repositories**. Seluna then sees only the repositories you pick, which limits what a webhook of a public repository can send you; the trade-off is that you add each new repository to the installation by hand (on GitHub, in the installation's settings). **All repositories** also covers new repositories automatically, but then every repository of the account, public ones included, reports to Seluna. Creating the app again replaces the saved one; delete the old app on GitHub.

Alternatively, set the Worker secrets `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` and `GITHUB_WEBHOOK_SECRET` yourself for an app you created by hand. Each of them takes precedence over the saved credential of the same name, and the step creates no app while any of them is set. Until the instance has a webhook secret, either set by you or saved by the step, it answers webhooks with 503.

## Status and settings

The setup page (`/setup`) is also the status page. It shows the version, the active messenger, where the Telegram bot token comes from (never its value), the Telegram chat, the GitHub App with a link to it, its owner and the accounts it is installed on (with the permissions or events the app or an installation still lacks, and where to add them), and the time of the last delivery received from GitHub; below it the **Messengers** card lists the messengers (Telegram so far), where you set one up, activate it or remove its saved credentials, and then the settings: the language of the notifications (English or German), your time zone, quiet hours, one switch for each kind of notification (the switches for new stars and forks are off until you turn them on), how stars and forks are reported (immediately, hourly or once a day at a time you choose, daily at 18:00 by default; the hourly and daily digest is one message per interval) and the notice about new Seluna releases. Issues and comments written by you are left out once the status page shows the app's owner (open it once after an update); for an organization's app, everyone's issues and comments are reported, because Seluna cannot tell which member you are. Select **Save settings**; the changes apply without a new deployment.

If you change `SELUNA_SECRET` later, Seluna can no longer read the saved credentials. Set the earlier secret again, or select **Reset and create the GitHub App again** on the setup page: Seluna deletes the saved GitHub credentials, the installation tokens and the saved Telegram bot token (the Telegram chat and the settings stay) and leads you through the GitHub App step again; enter the bot token again in the Telegram chat step. Delete the old app on GitHub afterwards.
