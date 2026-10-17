import type { AccountChoice } from "../github/manifest";

export const GITHUB_STATE_LIFETIME_MS = 3_600_000;
export const MAX_GITHUB_STATE_CHARACTERS = 139;

/** The signed state `v1.<type>.<account>.<expires>.<nonce>.<mac>`; `choice.account` must already pass `isAccountName`. */
export async function createGitHubState(
  _key: CryptoKey,
  _session: string,
  _choice: AccountChoice,
  _now: Date,
): Promise<string> {
  throw new Error("Not implemented");
}

/** Whether `state` has exactly the form of a state, without checking its MAC or expiry. */
export function isWellFormedGitHubState(_state: string): boolean {
  throw new Error("Not implemented");
}

/** The account choice the state was issued for, when it is valid for this session now; else `undefined`. Never throws. */
export async function verifyGitHubState(
  _key: CryptoKey,
  _state: string,
  _session: string,
  _now: Date,
): Promise<AccountChoice | undefined> {
  throw new Error("Not implemented");
}
