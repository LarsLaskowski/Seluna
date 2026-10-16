import { fromBase64Url, toBase64Url } from "../base64url";
import { parseChatId } from "../telegram";

/** A proof is accepted for 10 minutes after the test message was sent. */
export const CHAT_PROOF_LIFETIME_MS = 600_000;

const CODE_DIGITS = 6;
const CODE_SPACE = 1_000_000;
const CODE_DRAW_LIMIT = 4_294_000_000;
const CODE_FORM = /^\d{6}$/;
const PROOF_FORM = /^v1\.(-?[1-9]\d{0,15})\.([1-9]\d{0,14})\.([\w-]{43})$/;

function utf8(text: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(new TextEncoder().encode(text));
}

function macText(chatId: string, expires: string, session: string, code: string): Uint8Array<ArrayBuffer> {
  return utf8(`chat-proof.v1.${chatId}.${expires}.${session}.${code}`);
}

/** Six decimal digits drawn uniformly with `crypto.getRandomValues`. */
export function newChatCode(): string {
  const draw = new Uint32Array(1);
  do {
    crypto.getRandomValues(draw);
    // Values from 4,294,000,000 up are redrawn: the rest is an exact multiple of 1,000,000, so the modulo is uniform.
  } while ((draw[0] ?? 0) >= CODE_DRAW_LIMIT);
  return String((draw[0] ?? 0) % CODE_SPACE).padStart(CODE_DIGITS, "0");
}

/** `v1.<chatId>.<expires>.<mac>`; `key` from `signingKeyFromEnv(env, "setup-telegram")`, `session` the request's valid session token. */
export async function createChatProof(
  key: CryptoKey,
  session: string,
  chatId: number,
  code: string,
  now: Date,
): Promise<string> {
  const chat = String(chatId);
  const expires = String(now.getTime() + CHAT_PROOF_LIFETIME_MS);
  const mac = await crypto.subtle.sign("HMAC", key, macText(chat, expires, session, code));
  return `v1.${chat}.${expires}.${toBase64Url(new Uint8Array(mac))}`;
}

export type ChatProofCheck =
  | { readonly kind: "valid"; readonly chatId: number }
  | { readonly kind: "wrong-code"; readonly chatId: number }
  | { readonly kind: "invalid" };

/** Checks `proof` against `session` and `code` at `now` as the area document's *Chat proof* says; the MAC in constant time. */
export async function checkChatProof(
  key: CryptoKey,
  proof: string,
  session: string,
  code: string,
  now: Date,
): Promise<ChatProofCheck> {
  const match = PROOF_FORM.exec(proof);
  const chatText = match?.[1];
  const expiresText = match?.[2];
  const macPart = match?.[3];
  if (chatText === undefined || expiresText === undefined || macPart === undefined) {
    return { kind: "invalid" };
  }
  const chatId = parseChatId(chatText);
  const mac = fromBase64Url(macPart);
  const expires = Number(expiresText);
  if (
    chatId === undefined ||
    mac === undefined ||
    expires <= now.getTime() ||
    expires > now.getTime() + CHAT_PROOF_LIFETIME_MS
  ) {
    return { kind: "invalid" };
  }
  if (!CODE_FORM.test(code)) {
    return { kind: "wrong-code", chatId };
  }
  const verified = await crypto.subtle.verify("HMAC", key, mac, macText(chatText, expiresText, session, code));
  return { kind: verified ? "valid" : "wrong-code", chatId };
}
