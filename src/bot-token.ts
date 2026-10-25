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
/* eslint-disable @typescript-eslint/no-unused-vars -- skeleton: the implementation uses the parameters */
export function resolveBotToken(env: object, db: D1Database): Promise<ResolvedBotToken> {
  return Promise.reject(new Error("Not implemented"));
}
/* eslint-enable @typescript-eslint/no-unused-vars */
