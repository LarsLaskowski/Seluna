# Setup

How to deploy your own Seluna instance. A fuller guide follows in a later version.

## Before you deploy

- A Cloudflare account and a GitHub account.
- The token of your Telegram bot: in Telegram, send `/newbot` to [@BotFather](https://t.me/BotFather) and copy the token it returns.
- A `SELUNA_SECRET`: a random string of at least 32 characters, for example from a password manager or `openssl rand -hex 32`. It is the password of the `/setup` page and the source of the key that encrypts the stored credentials. Keep it: changing it later means running the setup again.

## Deploy

1. Select the **Deploy to Cloudflare** button in the [README](../README.md) and connect your GitHub account.
2. The button creates an independent copy of the repository in your GitHub account (not a fork), creates the D1 database, asks for `SELUNA_SECRET` and `TELEGRAM_BOT_TOKEN`, then builds and deploys the Worker.
3. Open `https://<worker>.<your-subdomain>.workers.dev/health`. It answers with the version.

## Updates

Every push to `main` of your copy builds and deploys it, after applying the database migrations.

## Next steps

Open `https://<worker>.<your-subdomain>.workers.dev/setup` and sign in with your `SELUNA_SECRET`. Then open the step **Telegram chat**: send `/start` to your bot (or add the bot to a group), search for chats, choose your own chat and type the code of the test message Seluna sends to it into the setup page. Seluna saves the chat once the code matches. Optionally, the Worker secret `TELEGRAM_CHAT_ID` sets the chat by hand and takes precedence over the chosen one.

Then open the step **GitHub App**. Choose your personal account or an organization, enter its name and select **Next**; Seluna shows what it will ask for (a private GitHub App with read-only access to Actions, Pull requests, Dependabot alerts, Code scanning alerts, Secret scanning alerts and Metadata, and the matching events). Select **Continue to GitHub**, check the details there (you can change the app's name) and select **Create GitHub App**. GitHub sends you back to the setup page: select **Finish** and Seluna saves the app's credentials encrypted. Do this within one hour and while you are still signed in to the setup page. Finally follow the link to install the app on your account or organization and choose **All repositories**, so that new repositories are covered too. Creating the app again replaces the saved one; delete the old app on GitHub.

Alternatively, set the Worker secrets `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` and `GITHUB_WEBHOOK_SECRET` yourself for an app you created by hand. Each of them takes precedence over the saved credential of the same name, and the step creates no app while any of them is set. Until the instance has a webhook secret, either set by you or saved by the step, it answers webhooks with 503.
