# Migrations

Schema migrations for the D1 binding `DB`.

- Files are named `NNNN_<name>.sql` and applied in name order, each once.
- `npm run db:migrations:apply` applies the unapplied ones to the remote database before every deploy.
- A released migration is never edited: a schema change is a new migration.
- The first migration follows with issue #7.
