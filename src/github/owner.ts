/** The account types an app owner can have. */
export type OwnerType = "User" | "Organization";

/** The owner of the GitHub App: its numeric id, login and type, each checked. */
export interface OwnerAccount {
  readonly id: number;
  readonly login: string;
  readonly type: OwnerType;
}

/** The owner narrowed from an unknown `owner` object, or `undefined` when any part is malformed. */
export function parseOwnerAccount(value: unknown): OwnerAccount | undefined {
  throw new Error("Not implemented");
}
