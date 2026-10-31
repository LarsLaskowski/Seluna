# 0042: Time zone aliases read as the listed name of their zone

- **Status:** Proposed
- **Date:** 2026-10-31
- **Area:** Setup wizard
- **Source:** Issue #129
- **Supersedes:** 0018 (amends only its choice of accepted time zones, options 3 and 4; the rest of 0018 stands)

## Context

[0018](0018-settings-and-status-page.md) accepts exactly the names of `Intl.supportedValuesOf("timeZone")` plus
`UTC`, and rejected "any value `Intl.DateTimeFormat` accepts" because aliases, letter-case variants and offsets
would then be stored in forms no list or comparison expects. The runtime lists CLDR's names, not IANA's: in the
Workers runtime of the tests (workerd 1.20261019.1, measured) `Asia/Calcutta`, `Europe/Kiev` and `Asia/Saigon` are
listed while `Asia/Kolkata`, `Europe/Kyiv` and `Asia/Ho_Chi_Minh` are not, though `Intl.DateTimeFormat` accepts them
and resolves them to the listed name. A stored IANA name therefore reads as UTC today, and a runtime update that
switched the list to IANA names would turn every saved zone of that kind into UTC without notice, moving quiet hours
and digest times ([0025](0025-quiet-hours-decided-at-sending.md) assumed the list never changes under a saved zone).

## Options considered

1. **A listed name as is; any other value as the zone the runtime resolves it to
   (`resolvedOptions().timeZone`), when that is a listed name; rejected otherwise** — one name per zone everywhere
   (stored value, select, status page, wall clock), the store stays in listed names, offsets and unknown names are
   still rejected, and the common case needs no formatter. Chosen.
2. **Any value `Intl.DateTimeFormat` accepts, stored as given** (0018's option 4) — keeps offsets such as `+01:00`
   and names the select cannot show as selected.
3. **A fixed alias table in Seluna** — follows no runtime update and must be maintained by hand.
4. **Match by resolving every listed name** — also covers a runtime whose list and resolution disagree, at the
   cost of one formatter per listed zone (418 in the test runtime) on every settings read; no such runtime was
   observed (every listed name resolves to itself in the test runtime).
5. **Accept aliases but keep letter case strict** — the runtime offers no case-sensitive check, and a case variant
   is stored as its listed name anyway, so the strictness protects nothing.

## Decision

A time zone, whether read from the `time_zone` row or posted by the settings form, is the listed name of its zone:
itself when the runtime lists it, else the name `Intl.DateTimeFormat` resolves it to when that name is listed, else
invalid (read as UTC, the form rejected). The rules are in [`areas/storage.md`](../areas/storage.md) and
[`areas/setup-wizard.md`](../areas/setup-wizard.md).

## Consequences

- A saved zone survives a runtime update that renames it, as long as the runtime still accepts the old name as an
  alias and resolves it to a listed name; the stored row keeps the old name until the owner saves the settings.
- The status page and the select show the runtime's name of the zone, which can differ from the stored text.
- Letter-case variants and other aliases (such as `US/Eastern`) posted by hand are accepted and stored as the listed
  name; offsets and names that resolve to no listed name (`+01:00`, `Etc/GMT+5` in the test runtime) stay rejected.
- What the deployed runtime lists and resolves for these names was not measured; a runtime whose list and resolution
  disagree would read such a zone as UTC, as before (option 4 would be the fix).
