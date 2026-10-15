# Areas

What the software does, area by area. Each area has one document here that states the behavior a user, an
operator or another component can rely on — formats, limits, error behavior, guarantees. The
[decision records](../decisions/README.md) explain *why* individual choices were made; the area documents say
*what holds today*. `ARCHITECTURE.md` shows how the parts fit together and links the areas instead of repeating them.

## Rules

- **One document per area**, `docs/areas/<slug>.md`, created from [`_template.md`](_template.md) and listed in the
  index below. The squad Lead keeps it in step with the code: a change in behavior updates the area document in the
  same pull request.
- **Normative and stable.** Write what must hold, not how one language or library does it: the test is whether
  the document would still be true if the component were rewritten in another language. No class, package or
  function names as a contract (mention them only as a pointer to where it is implemented).
- **One home per behavior.** A cross-cutting topic (security, offline behavior) lives in the area that owns it; the
  others link there.
- **Size.** One readable document per area: split one that grows past a few thousand words, fold one that
  says only a few sentences into a neighbor. Development and release process are not areas (see
  `CONTRIBUTING.md`).
- **A new area is a Lead decision** made in the plan (`plan.md`, *Areas*), with its name and scope in the index.
- Every decision record names its area in its `Area:` field (`—` for a record about the process). Area documents are
  not frozen by a release; their history is Git.

## Index

<!-- project:begin area-index -->

| Area | Scope | Not here |
| ---- | ----- | -------- |
| [HTTP routes](http-routes.md) | The public routes with their status and body, the request body size limit, the webhook signature check, the per-request log entry | Webhook event processing, the setup wizard |
| [Deployment](deployment.md) | The Deploy to Cloudflare button, the D1 binding and migrations, the Worker secrets, the cron triggers, the deploy command of Workers Builds | What the cron jobs do, the release process |
| [Setup wizard](setup-wizard.md) | The pages under `/setup`: the refusal without a usable `SELUNA_SECRET`, the login and its lock, the session, the CSRF protection, the page and header rules, the languages | The routes outside `/setup` and the body size limit (HTTP routes), the `meta` table (Storage) |
| [Storage](storage.md) | The D1 tables and columns, data access through `src/store/`, the encryption of credentials and installation tokens, the key check for a changed `SELUNA_SECRET` | How migrations are applied (Deployment), what each setting means (setup wizard), row cleanup (cron) |

<!-- project:end area-index -->
