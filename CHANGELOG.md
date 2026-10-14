# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Cloudflare Workers project skeleton in TypeScript with a fetch handler that answers every request with 404.
- Squad, quality gates (Prettier, type-aware ESLint with SonarJS, Istanbul coverage) and CI adopted from the Squad-Spec-Repository-Template `typescript` profile, with architecture documentation and decision records.
- Release workflow that publishes a GitHub release when a `vA.B.C` tag is pushed on `main`, after checking the tag, the `package.json` version, the changelog section and the format, lint, type-check, test and build checks.
