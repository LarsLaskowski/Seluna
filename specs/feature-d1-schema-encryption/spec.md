# Spec: D1 schema and encryption of credentials

Status: Approved by Lead

Source: Issue #7 "[Storage] D1 schema and encryption of credentials" (no comments; dependency #6 closed).

## Problem / motivation

Every later feature keeps state in the instance's D1 database: the webhook pipeline deduplicates deliveries and
writes the outbox (#12), the GitHub client caches installation tokens (#15), the cron retries and cleans up
(#18), and the setup wizard stores settings and the GitHub App credentials (#8–#11). Today `migrations/` holds no
migration, so the database has no tables, and nothing can store a credential safely. The goal of the issue:
settings and GitHub App credentials are stored safely, and someone who can only read D1 learns nothing.

## Behavior

The normative statements live in [`docs/areas/storage.md`](../../docs/areas/storage.md); each bullet here is one
behavior the change delivers.

- B1: Deploying an instance creates exactly the six tables `settings`, `secrets`, `deliveries`, `outbox`,
  `token_cache` and `meta` with the columns, types, defaults and constraints of the area document, through one
  migration that applies cleanly to an empty database.
- B2: A credential written to D1 appears there only as base64 IV and ciphertext; neither the value nor any
  encoding of it is readable in the row.
- B3: Every write of a value uses a fresh random 12-byte IV, so the same value written twice gives two different
  rows.
- B4: A credential written under a `SELUNA_SECRET` reads back as the same value under that `SELUNA_SECRET`.
- B5: Reading a credential that was never written reports "missing".
- B6: The first credential written also stores the key check value in `meta`, in the same transaction.
- B7: After `SELUNA_SECRET` changed, reading a stored credential reports "secret changed", and writing one reports
  "secret changed" and changes nothing.
- B8: A stored credential whose ciphertext was altered, is malformed, or was copied from another row reports
  "corrupt"; so does a stored credential when the key check value is absent or malformed.
- B9: The encryption key is derived with HKDF-SHA256 from `SELUNA_SECRET`, salt and info `seluna/secrets/v1`, so a
  value encrypted by any implementation of those parameters decrypts.
- B10: `SELUNA_SECRET` counts as configured only when it is a string of at least 32 characters (code points);
  otherwise no key is derived.
- B11: The installation-token table holds tokens only encrypted (`iv`, `ciphertext`), deviating from the issue's
  plain `token` column (decision 0007).
- B12: Only modules under `src/store/` access D1.

## Acceptance criteria

- [ ] AC1 (issue): Encrypted values are not readable in D1 (B2, B3).
- [ ] AC2 (issue): Decrypting with a different `SELUNA_SECRET` fails and is reported as a changed secret (B7).
- [ ] AC3 (issue): Migrations apply cleanly to an empty database (B1, B11).
- [ ] AC4: Round trip and missing credential (B4, B5).
- [ ] AC5: Key check value written with the first credential; absent or malformed key check reported (B6, B8).
- [ ] AC6: Altered, malformed or moved ciphertext is reported as corrupt, never returned (B8).
- [ ] AC7: Key derivation parameters pinned by a known vector (B9).
- [ ] AC8: `SELUNA_SECRET` acceptance rule (B10).

The testable form of each criterion, with its tests, is in [plan.md](plan.md).

## Out of scope

- Access modules for `settings`, `deliveries`, `outbox`, `token_cache` and the other `meta` keys: each comes with
  the issue that first uses the table (#11, #12, #15, #18; decision 0014).
- The reset of a changed `SELUNA_SECRET` (clearing `secrets`, `token_cache` and the key check) and its wizard page:
  issue #11.
- Reading the webhook secret from D1 instead of `GITHUB_WEBHOOK_SECRET`, and Worker-secret precedence: issue #10.
- Encrypting installation tokens on write: issue #15, with the functions of this change.
- The setup login's own refusal of a short `SELUNA_SECRET`: issue #8 (it should reuse this change's check).
- Wiring the store into the `fetch` or `scheduled` handler: no caller exists yet.

## Open questions

None for the Product Manager. Interpretations the Lead settled (decision 0007): salt and info are both
`seluna/secrets/v1`; the key check is an encrypted constant; `token_cache` is encrypted.
