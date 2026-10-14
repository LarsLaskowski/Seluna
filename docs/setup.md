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

The `/setup` wizard follows in a later version. Until then the instance answers webhooks with 503.
