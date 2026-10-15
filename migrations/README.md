# Migrations

Schema migrations for the D1 binding `DB`.

- Files are named `NNNN_<name>.sql` and applied in name order, each once.
- `npm run db:migrations:apply` applies the unapplied ones to the remote database before every deploy.
- A migration is never edited once it is on `main`: a schema change is a new migration.

Migrations:

- `0001_initial_schema.sql`: all six tables (`settings`, `secrets`, `deliveries`, `outbox`, `token_cache`, `meta`), see `docs/areas/storage.md`.
