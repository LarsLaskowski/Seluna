# Seluna

Seluna sends a Telegram message when something in your GitHub repositories needs attention: a pull request is ready, a review is requested, CI failed or a security alert was opened. Draft pull requests trigger nothing. Every user runs their own instance: a private GitHub App sends webhooks to a Cloudflare Worker in your own Cloudflare account, which stores its state in D1 and delivers through your own Telegram bot. There is no central service.

> **Status:** Seluna is under development and not usable yet.

<!-- Deploy to Cloudflare button: placeholder -->
