import { keyFromEnv } from "./crypto";
import { checkKey, deleteSecret, readSecret } from "./store/secrets";
import { botTokenFromEnv, isBotToken } from "./telegram";

export type BotTokenSource = "worker-secret" | "saved";

export type ResolvedBotToken =
  | { readonly kind: "usable"; readonly token: string; readonly source: BotTokenSource }
  | { readonly kind: "malformed" }
  | { readonly kind: "missing" }
  | { readonly kind: "unreadable" }
  | { readonly kind: "damaged" };

/**
 * The bot token to use: `TELEGRAM_BOT_TOKEN` from the Worker environment when it is set (usable or malformed, without
 * falling back and without reading D1), otherwise the token saved in the setup. `unreadable`: the saved token cannot
 * be decrypted with the current `SELUNA_SECRET`; `damaged`: only its own row is damaged or holds a value outside the
 * bot token form. D1 errors are not caught.
 */
export async function resolveBotToken(env: object, db: D1Database): Promise<ResolvedBotToken> {
  const fromEnv = botTokenFromEnv(env);
  if (fromEnv.kind === "usable") {
    return { kind: "usable", token: fromEnv.token, source: "worker-secret" };
  }
  if (fromEnv.kind === "malformed") {
    return fromEnv;
  }
  const key = await keyFromEnv(env);
  if (key === undefined) {
    return { kind: "missing" };
  }
  const saved = await readSecret(db, key, "telegram_bot_token");
  switch (saved.kind) {
    case "ok":
      // A saved value outside the allow-list is never placed in a URL.
      return isBotToken(saved.value) ? { kind: "usable", token: saved.value, source: "saved" } : { kind: "damaged" };
    case "missing":
      return { kind: "missing" };
    case "secret-changed":
      return { kind: "unreadable" };
    case "corrupt":
      // A damaged key check value is a problem of all credentials; a matching one leaves only this row damaged.
      return (await checkKey(db, key)) === "match" ? { kind: "damaged" } : { kind: "unreadable" };
    default: {
      const unreachable: never = saved;
      return unreachable;
    }
  }
}

export type RemoveTokenResult =
  { readonly kind: "removed" } | { readonly kind: "worker-secret" } | { readonly kind: "unreadable" };

/** Deletes the saved bot token (also when none is saved); calls no Telegram API. D1 errors are not caught. */
export async function removeBotToken(env: object, db: D1Database): Promise<RemoveTokenResult> {
  if (botTokenFromEnv(env).kind !== "missing") {
    return { kind: "worker-secret" };
  }
  if ((await resolveBotToken(env, db)).kind === "unreadable") {
    return { kind: "unreadable" };
  }
  await deleteSecret(db, "telegram_bot_token");
  return { kind: "removed" };
}
