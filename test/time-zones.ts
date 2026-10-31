import { assert } from "vitest";
import { timeZones } from "../src/settings";

/** Pairs of spellings of one zone: the runtime lists one and, while it canonicalizes, resolves the other to it. */
export const ZONE_PAIRS: readonly { readonly pair: string; readonly names: readonly [string, string] }[] = [
  { pair: "Asia/Kolkata and Asia/Calcutta", names: ["Asia/Kolkata", "Asia/Calcutta"] },
  { pair: "Europe/Kyiv and Europe/Kiev", names: ["Europe/Kyiv", "Europe/Kiev"] },
  { pair: "Asia/Ho_Chi_Minh and Asia/Saigon", names: ["Asia/Ho_Chi_Minh", "Asia/Saigon"] },
];

/** What the runtime resolves `zone` to, written independently of `src/settings.ts`. */
function resolvedName(zone: string): string {
  return new Intl.DateTimeFormat("en", { timeZone: zone }).resolvedOptions().timeZone;
}

/**
 * The listed and the unlisted spelling of a pair; fails the test when the runtime does not list exactly one
 * spelling or does not resolve the other to it.
 */
export function spellingsOf(names: readonly [string, string]): { readonly listed: string; readonly alias: string } {
  const zones = timeZones();
  const [first, second] = names;
  const listedNames = names.filter((name) => zones.includes(name));
  assert.lengthOf(listedNames, 1, "the runtime lists exactly one spelling");
  const listed = zones.includes(first) ? first : second;
  const alias = listed === first ? second : first;
  assert.equal(
    resolvedName(alias),
    listed,
    "the runtime resolves the alias to the listed name — if not, AC7's path applies",
  );
  return { listed, alias };
}

/** Fails the test unless the runtime accepts `zone`, does not list it and resolves it to itself. */
export function assertKeptUnlisted(zone: string): void {
  assert.isFalse(timeZones().includes(zone), "the runtime keeps the zone unlisted and by its own name");
  assert.equal(resolvedName(zone), zone, "the runtime keeps the zone unlisted and by its own name");
}
