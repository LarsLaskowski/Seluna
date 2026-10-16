/** A proof is accepted for 10 minutes after the test message was sent. */
export const CHAT_PROOF_LIFETIME_MS = 600_000;

/** Six decimal digits drawn uniformly with `crypto.getRandomValues`. */
export function newChatCode(): string {
  throw new Error("Not implemented");
}

/** `v1.<chatId>.<expires>.<mac>`; `key` from `signingKeyFromEnv(env, "setup-telegram")`, `session` the request's valid session token. */
export function createChatProof(
  key: CryptoKey,
  session: string,
  chatId: number,
  code: string,
  now: Date,
): Promise<string> {
  throw new Error("Not implemented");
}

export type ChatProofCheck =
  | { readonly kind: "valid"; readonly chatId: number }
  | { readonly kind: "wrong-code"; readonly chatId: number }
  | { readonly kind: "invalid" };

/** Checks `proof` against `session` and `code` at `now` as the area document's *Chat proof* says; the MAC in constant time. */
export function checkChatProof(
  key: CryptoKey,
  proof: string,
  session: string,
  code: string,
  now: Date,
): Promise<ChatProofCheck> {
  throw new Error("Not implemented");
}
