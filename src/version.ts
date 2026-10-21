/** A release version `A.B.C`. */
export interface Version {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

/** The version of `text` (`A.B.C`, ASCII digits, no leading zeros, at most 9 digits a part), or `undefined`. */
export function parseVersion(text: string): Version | undefined {
  throw new Error("Not implemented");
}

/** The version of a release tag `vA.B.C` in the same form, or `undefined`. */
export function parseReleaseTag(tag: string): Version | undefined {
  throw new Error("Not implemented");
}

/** Negative when `left` is older, 0 when equal, positive when newer. */
export function compareVersions(left: Version, right: Version): number {
  throw new Error("Not implemented");
}

/** `A.B.C` of `version`. */
export function versionText(version: Version): string {
  throw new Error("Not implemented");
}
