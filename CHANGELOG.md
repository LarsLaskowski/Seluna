# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Cloudflare Workers project skeleton in TypeScript.
- HTTP routes: `GET /health` with the version of the build, `POST /webhook` (see below), 404 with an empty body for everything else, 413 for request bodies over 1 MiB, and one log entry per request with method, path and status.
- Webhook signature check: `POST /webhook` verifies `X-Hub-Signature-256` (HMAC-SHA256 over the raw body) with the `GITHUB_WEBHOOK_SECRET` Worker secret and answers 202 for a valid signature, 401 for a missing or wrong one and 503 when no secret is configured; its log entry also holds the delivery id and event.
- Squad, quality gates (Prettier, type-aware ESLint with SonarJS, Istanbul coverage) and CI adopted from the Squad-Spec-Repository-Template `typescript` profile, with architecture documentation and decision records.
- Release workflow that publishes a GitHub release when a `vA.B.C` tag is pushed on `main`, after checking the tag, the `package.json` version, the changelog section and the format, lint, type-check, test and build checks.
