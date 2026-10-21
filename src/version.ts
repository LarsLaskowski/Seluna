/** A release version `A.B.C`. */
export interface Version {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

// ASCII digits only and no `u`/`m` flag, so `$` is the end of the input and a trailing line feed does not match.
const PART = "(0|[1-9][0-9]{0,8})";
const VERSION_PATTERN = new RegExp(String.raw`^${PART}\.${PART}\.${PART}$`);

/** The version of `text` (`A.B.C`, ASCII digits, no leading zeros, at most 9 digits a part), or `undefined`. */
export function parseVersion(text: string): Version | undefined {
  const match = VERSION_PATTERN.exec(text);
  const [, major, minor, patch] = match ?? [];
  if (major === undefined || minor === undefined || patch === undefined) {
    return undefined;
  }
  return { major: Number(major), minor: Number(minor), patch: Number(patch) };
}

/** The version of a release tag `vA.B.C` in the same form, or `undefined`. */
export function parseReleaseTag(tag: string): Version | undefined {
  return tag.startsWith("v") ? parseVersion(tag.slice(1)) : undefined;
}

/** Negative when `left` is older, 0 when equal, positive when newer. */
export function compareVersions(left: Version, right: Version): number {
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}

/** `A.B.C` of `version`. */
export function versionText(version: Version): string {
  return `${String(version.major)}.${String(version.minor)}.${String(version.patch)}`;
}
