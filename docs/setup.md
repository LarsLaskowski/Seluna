# Setup

How to deploy your own Seluna instance. A fuller guide follows in a later version.

## Before you deploy

- A Cloudflare account and a GitHub account.
- The token of your Telegram bot: in Telegram, send `/newbot` to [@BotFather](https://t.me/BotFather) and copy the token it returns.
- A `SELUNA_SECRET`: a random string of at least 32 characters, for example from a password manager or `openssl rand -hex 32`. It is the password of the `/setup` page and the source of the key that encrypts the stored credentials. Keep it: changing it later means running the setup again.

## Deploy

1. Select the **Deploy to Cloudflare** button in the [README](../README.md) and connect your GitHub account.
2. The button creates an independent copy of the repository in your GitHub account (not a fork), creates the D1 database, asks for `SELUNA_SECRET` and `TELEGRAM_BOT_TOKEN`, then builds and deploys the Worker. If the form lets you edit the deploy command, set it to `npm run deploy`.
3. In the Cloudflare dashboard open **Workers & Pages**, your Worker, **Settings** and **Build**, and check that the **Deploy command** is `npm run deploy`. The button may set `npx wrangler deploy` instead, which deploys the Worker without creating the database tables; signing in on `/setup` then shows _The database of this instance is missing its tables_. If it reads anything else, change it to `npm run deploy` and retry the latest build. The build log of a correct deploy shows the line `> wrangler d1 migrations apply DB --remote`.
4. Open `https://<worker>.<your-subdomain>.workers.dev/health`. It answers with the version; it does not check the database.

## Updates

Every push to `main` of your copy builds and deploys it; with the deploy command `npm run deploy` it applies the database migrations first.

## Next steps

Open `https://<worker>.<your-subdomain>.workers.dev/setup` and sign in with your `SELUNA_SECRET`. Then open the step **Telegram chat**: send `/start` to your bot (or add the bot to a group), search for chats, choose your own chat and type the code of the test message Seluna sends to it into the setup page. Seluna saves the chat once the code matches. Optionally, the Worker secret `TELEGRAM_CHAT_ID` sets the chat by hand and takes precedence over the chosen one.

Then open the step **GitHub App**. Choose your personal account or an organization, enter its name and select **Next**; Seluna shows what it will ask for (a private GitHub App with read-only access to Actions, Pull requests, Dependabot alerts, Code scanning alerts, Secret scanning alerts and Metadata, and the matching events). Select **Continue to GitHub**, check the details there (you can change the app's name) and select **Create GitHub App**. GitHub sends you back to the setup page: select **Finish** and Seluna saves the app's credentials encrypted. Do this within one hour and while you are still signed in to the setup page. Finally follow the link to install the app on your account or organization and choose **All repositories**, so that new repositories are covered too. Creating the app again replaces the saved one; delete the old app on GitHub.

Alternatively, set the Worker secrets `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` and `GITHUB_WEBHOOK_SECRET` yourself for an app you created by hand. Each of them takes precedence over the saved credential of the same name, and the step creates no app while any of them is set. Until the instance has a webhook secret, either set by you or saved by the step, it answers webhooks with 503.

## Status and settings

The setup page (`/setup`) is also the status page. It shows the version, the Telegram chat, the GitHub App with a link to it and the accounts it is installed on, and the time of the last delivery received from GitHub, and below it the settings: the language of the notifications (English or German), your time zone, quiet hours, one switch for each kind of notification and the notice about new Seluna releases. Select **Save settings**; the changes apply without a new deployment.

If you change `SELUNA_SECRET` later, Seluna can no longer read the saved GitHub credentials. Set the earlier secret again, or select **Reset and create the GitHub App again** on the setup page: Seluna deletes the saved GitHub credentials and installation tokens (the Telegram chat and the settings stay) and leads you through the GitHub App step again. Delete the old app on GitHub afterwards.
