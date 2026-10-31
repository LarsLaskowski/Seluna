# 0042: Time zone aliases read as the listed name of their zone, other zone names as the runtime's name

- **Status:** Proposed
- **Date:** 2026-10-31
- **Area:** Setup wizard
- **Source:** Issue #129
- **Supersedes:** 0018 (amends only its choice of accepted time zones, options 3 and 4, and its consequence that a stored zone the runtime stops listing reads as `UTC`; the rest of 0018 stands) and 0025 (amends only its consequence that the settings accept only zones the runtime lists; the rest of 0025 stands)

## Context

[0018](0018-settings-and-status-page.md) accepts exactly the names of `Intl.supportedValuesOf("timeZone")` plus
`UTC`, and rejected "any value `Intl.DateTimeFormat` accepts" because aliases, letter-case variants and offsets
would then be stored in forms no list or comparison expects. The runtime lists CLDR's names, not IANA's: in the
Workers runtime of the tests (workerd 1.20261019.1, measured) `Asia/Calcutta`, `Europe/Kiev` and `Asia/Saigon` are
listed while `Asia/Kolkata`, `Europe/Kyiv` and `Asia/Ho_Chi_Minh` are not, though `Intl.DateTimeFormat` accepts them
and resolves them to the listed name. Only listed names can be saved, so no instance holds another one today; but a
runtime update that changed the list would turn every saved zone it no longer lists into UTC without notice, moving
quiet hours and digest times (a case [0025](0025-quiet-hours-decided-at-sending.md) left to a runtime whose list changed). ECMA-402 is expected to make exactly that change (TC39 proposal-canonical-tz, folded into Temporal; not
yet in any runtime measured): the list moves to IANA primary names and `resolvedOptions().timeZone` stops
canonicalizing, so a saved `Asia/Calcutta` would resolve to itself and be unlisted.

## Options considered

1. **A listed name as is; any other value as the zone name the runtime resolves it to
   (`resolvedOptions().timeZone`), listed or not, unless that is a fixed offset; rejected otherwise** — today an
   alias becomes its listed name, after the expected change a saved name keeps working under its own name; the store
   holds only runtime output, offsets and unknown names are still rejected, and the common case needs no formatter.
   Chosen.
2. **Only names that are listed or resolve to a listed name** (the first plan) — fails in the runtime the
   expected change brings: the saved name resolves to itself, unlisted, and reads as UTC.
3. **Identify equal zones with `Temporal.ZonedDateTime#equals`** — `Temporal` is absent in the measured runtimes, so
   the path cannot be tested, and finding the listed spelling costs a scan of every listed zone per read.
4. **Compare the offsets of two zones at sample instants** — a guess: distinct zones share their current rules.
5. **Any value `Intl.DateTimeFormat` accepts, stored as given** (0018's option 4) — keeps offsets such as `+01:00`
   and raw input in any letter case.
6. **A fixed alias table in Seluna** — follows no runtime update and must be maintained by hand.
7. **Accept aliases but keep letter case strict** — the runtime offers no case-sensitive check, and a case variant
   is stored as its resolved name anyway, so the strictness protects nothing.

## Decision

A time zone, whether read from the `time_zone` row or posted by the settings form, is itself when the runtime lists
it, else the name `Intl.DateTimeFormat` resolves it to unless that is a fixed offset (`+HH:MM` / `-HH:MM`), else
invalid (read as UTC, the form rejected). A configured zone the runtime does not list is offered as the first,
selected option of the select. The rules are in [`areas/storage.md`](../areas/storage.md) and
[`areas/setup-wizard.md`](../areas/setup-wizard.md).

## Consequences

- A saved zone survives a runtime update that renames it as long as the runtime still accepts the old name; the
  stored row keeps the old text until the owner saves the settings.
- The status page and the select show the runtime's name of the zone, which can differ from the stored text; after
  the expected change, an old name and its new listed name can both appear in the select, the old one selected.
- Letter-case variants, aliases (such as `US/Eastern`) and unlisted zone names (such as `Etc/GMT+5`) posted by hand
  are accepted and stored as the runtime's name; offsets and names the runtime rejects stay rejected.
- What the deployed runtime lists and resolves was not measured; a zone the runtime stops accepting altogether reads
  as UTC, as before.
