# 0020: Deploy command checked in the setup guide

- **Status:** Accepted
- **Date:** 2026-10-17
- **Area:** Deployment
- **Source:** Issue #46
- **Supersedes:** 0013 — amends how the deploy command that applies the migrations gets into the copy's build
  settings; the rest of 0013 stands.

## Context

[Decision 0013](0013-deploy-to-cloudflare-and-workers-builds.md) relies on the Deploy to Cloudflare button taking the
deploy command from the `deploy` script in `package.json`, as Cloudflare documents (`workers/platform/deploy-buttons`,
_Best practices_: the button pre-fills the build and deploy commands from the scripts and falls back to
`npx wrangler deploy` without a `deploy` script), and names the first deployment with a real account as the
verification of the button's flow. That deployment (issue #46) took the `build` script but set the deploy command to
`npx wrangler deploy`, although the `deploy` script is present, so no migration ran and `/setup` showed only the
_unavailable_ notice. Changing the deploy command to `npm run deploy` in the Worker's build settings and retrying
the build applied the migrations with the token Workers Builds generates. Workers Builds runs the deploy command
stored in those settings (`workers/ci-cd/builds/configuration`); neither `package.json` nor `wrangler.jsonc` has
another documented setting the button or Workers Builds reads for it. Whether the button's behavior differs from its
documentation on purpose or by a bug is not known.

## Options considered

1. **The setup guide has the user check the deploy command after the button's deploy** and correct it and retry the
   build if it reads anything else — works whatever the button pre-fills, and the retry was verified in issue #46;
   the first build may run without migrations, which the retry repairs.
2. **A repository setting the button reads** — Cloudflare documents none beyond the `deploy` script, which is
   already present. Not available.
3. **Apply the migrations in the `build` script**, which the button did take — the build command also runs in CI
   (`npm run build` in `ci.yml` and `release.yml`, without Cloudflare credentials) and, when preview builds are on,
   in Workers Builds for branches other than `main`, so an unmerged migration would reach the instance's database.
4. **Apply the migrations from Wrangler's custom build (`build.command` in `wrangler.jsonc`)** — runs on every
   `wrangler deploy`, whatever the deploy command, but also on `wrangler dev` and on a preview build of another
   branch, with the same effect as option 3.
5. **The Worker applies the schema itself at runtime** — needs no deploy command, but replaces Wrangler's migration
   tracking with Seluna's own, and a failed migration no longer stops a deploy: new code would run against the old
   schema, the risk decision 0013 rejects with its option 6.

## Decision

The repository keeps the `deploy` script as the documented source of the deploy command, and the setup guide has the
user make sure the copy's build settings use `npm run deploy` after the button's deploy (option 1). The rules are in
[`areas/deployment.md`](../areas/deployment.md).

## Consequences

Until the user corrects the deploy command, every build deploys without migrations; `/health` reads no D1 and does
not show it, so the guide points to the build log instead. The check stays in the guide even if a later version of
the button pre-fills `npm run deploy` as documented, since that cannot be told from the repository. The setup login
names a database without tables ([decision 0021](0021-missing-tables-notice-on-the-setup-login.md)). Revisiting this needs a setting the button reads
for the deploy command, or a migration path outside the deploy command that does not run for unmerged branches.
