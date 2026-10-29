import { isAccountName } from "./manifest";

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
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const { id, login, type } = value as Record<string, unknown>; // narrowed to an object above; every part is checked below
  if (
    typeof id !== "number" ||
    !Number.isSafeInteger(id) ||
    id < 1 ||
    typeof login !== "string" ||
    !isAccountName(login) ||
    (type !== "User" && type !== "Organization")
  ) {
    return undefined;
  }
  return { id, login, type };
}
