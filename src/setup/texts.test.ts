import { describe, expect, it } from "vitest";
import { TEXTS } from "./texts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Every text in `value`, whatever the nesting of records and lists. */
function textsOf(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  return isRecord(value) ? Object.values(value).flatMap(textsOf) : [];
}

describe("TEXTS", () => {
  it("texts define a non-empty text for every key in English and German", () => {
    const emptyEnglish = textsOf(TEXTS.en).filter((text) => text.trim() === "");
    const emptyGerman = textsOf(TEXTS.de).filter((text) => text.trim() === "");

    expect(emptyEnglish, "empty English texts").toEqual([]);
    expect(emptyGerman, "empty German texts").toEqual([]);
    expect(TEXTS.en.notConfiguredParagraphs.length, "English not-configured paragraphs").toBeGreaterThan(0);
    expect(TEXTS.de.notConfiguredParagraphs.length, "German not-configured paragraphs").toBeGreaterThan(0);
    expect(Object.keys(TEXTS.de.notices), "German notice keys").toEqual(Object.keys(TEXTS.en.notices));
    expect(Object.keys(TEXTS.en.notices).length, "number of notices").toBe(13);
  });

  it("texts word the English notices as the area document does", () => {
    expect(TEXTS.en.notices, "English notices").toEqual({
      "wrong-secret": "That is not the SELUNA_SECRET of this instance.",
      locked:
        "Too many failed attempts. Signing in is locked for 15 minutes after the fifth failed attempt; try again later.",
      "form-expired": "The form has expired. Please submit it again.",
      unavailable: "The setup is unavailable right now. Please try again in a moment.",
      "telegram-token-missing":
        "The Worker secret TELEGRAM_BOT_TOKEN is not set. In Telegram, send /newbot to @BotFather and copy the token it returns. In the Cloudflare dashboard open this Worker, then Settings, then Variables and Secrets, and add a secret named TELEGRAM_BOT_TOKEN with that token. Or run: npx wrangler secret put TELEGRAM_BOT_TOKEN",
      "telegram-token-malformed":
        "The Worker secret TELEGRAM_BOT_TOKEN is not a bot token. A token from @BotFather is digits, a colon, then letters, digits, - and _, without spaces. Copy it again from @BotFather and replace the secret in the Cloudflare dashboard under Settings, then Variables and Secrets.",
      "telegram-token-rejected":
        "Telegram does not accept the Worker secret TELEGRAM_BOT_TOKEN: it is mistyped or was revoked. Send /mybots to @BotFather, copy your bot's current token and replace the secret in the Cloudflare dashboard under Settings, then Variables and Secrets.",
      "telegram-conflict":
        "Telegram does not hand the bot's chats to Seluna because another program receives its updates (a webhook, or a program that polls the bot). Seluna needs a bot of its own: create one with /newbot at @BotFather, or remove the webhook from this bot.",
      "telegram-unavailable":
        "Telegram could not be reached or gave an answer Seluna cannot read. Please try again in a moment.",
      "telegram-send-failed":
        "The test message could not be sent, so the chat was not saved. Check that the bot is still in the chat and not blocked, then search again.",
      "telegram-invalid-chat": "Please choose a chat from the list.",
      "telegram-wrong-code":
        "The code does not match the test message. Check the code in your chat and enter it again.",
      "telegram-code-expired":
        "The code has expired or the form is no longer valid. Search for chats again and send a new test message.",
    });
  });

  it("texts word the English Telegram step as the area document does", () => {
    const { en } = TEXTS;

    expect(
      {
        startBody: en.startBody,
        telegramHeading: en.telegramHeading,
        telegramIntro: en.telegramIntro,
        telegramSearchLink: en.telegramSearchLink,
        telegramChatIdSecret: en.telegramChatIdSecret,
        telegramSavedChat: en.telegramSavedChat,
        telegramNoSavedChat: en.telegramNoSavedChat,
        telegramChatsIntro: en.telegramChatsIntro,
        telegramNoChats: en.telegramNoChats,
        telegramPrivateChat: en.telegramPrivateChat,
        telegramGroup: en.telegramGroup,
        telegramConfirmButton: en.telegramConfirmButton,
        telegramTestMessage: en.telegramTestMessage,
        telegramCodeSent: en.telegramCodeSent,
        telegramCodeIntro: en.telegramCodeIntro,
        telegramCodeLabel: en.telegramCodeLabel,
        telegramCodeButton: en.telegramCodeButton,
      },
      "English Telegram step texts",
    ).toEqual({
      startBody: "Set up your instance step by step:",
      telegramHeading: "Telegram chat",
      telegramIntro:
        "Seluna sends its notifications to one Telegram chat. Open your bot in Telegram and send /start, or add the bot to a group. Then search for chats.",
      telegramSearchLink: "Search for chats",
      telegramChatIdSecret:
        "The chat is set by the Worker secret TELEGRAM_CHAT_ID, which takes precedence over a chat chosen here. To choose the chat here, delete that secret.",
      telegramSavedChat: "Saved chat:",
      telegramNoSavedChat: "No chat is saved yet.",
      telegramChatsIntro:
        "Chats your bot has seen recently. Anyone who messages your bot appears here, so choose only your own chat: Seluna sends a test message with a code to it, and the chat is saved once you enter that code.",
      telegramNoChats:
        "No chat found. Send /start to your bot or add it to a group, then search again. Telegram keeps messages to the bot for 24 hours, and Seluna sees only the newest 100: if your bot receives many messages, send /start again just before you search.",
      telegramPrivateChat: "Private chat",
      telegramGroup: "Group",
      telegramConfirmButton: "Send test message",
      telegramTestMessage:
        "Seluna setup: to send the notifications of your instance to this chat, enter this code on your setup page. If you did not ask for it, ignore this message. Code:",
      telegramCodeSent: "Test message sent to chat:",
      telegramCodeIntro:
        "Enter the six-digit code from that message to save the chat. If no message arrived, the chat is not yours: search again and choose another.",
      telegramCodeLabel: "Code",
      telegramCodeButton: "Save chat",
    });
  });
});
