import type { Language } from "./language";

export type Notice =
  | "wrong-secret"
  | "locked"
  | "form-expired"
  | "unavailable"
  | "telegram-token-missing"
  | "telegram-token-malformed"
  | "telegram-token-rejected"
  | "telegram-conflict"
  | "telegram-unavailable"
  | "telegram-send-failed"
  | "telegram-invalid-chat"
  | "telegram-wrong-code"
  | "telegram-code-expired";

export interface SetupTexts {
  readonly pageTitle: string;
  readonly languageLabel: string;
  readonly loginHeading: string;
  readonly loginIntro: string;
  readonly secretLabel: string;
  readonly loginButton: string;
  readonly startHeading: string;
  readonly startBody: string;
  readonly logoutButton: string;
  readonly telegramHeading: string;
  readonly telegramIntro: string;
  readonly telegramSearchLink: string;
  readonly telegramChatIdSecret: string;
  readonly telegramSavedChat: string;
  readonly telegramNoSavedChat: string;
  readonly telegramChatsIntro: string;
  readonly telegramNoChats: string;
  readonly telegramPrivateChat: string;
  readonly telegramGroup: string;
  readonly telegramConfirmButton: string;
  readonly telegramTestMessage: string;
  readonly telegramCodeSent: string;
  readonly telegramCodeIntro: string;
  readonly telegramCodeLabel: string;
  readonly telegramCodeButton: string;
  readonly notConfiguredHeading: string;
  readonly notConfiguredParagraphs: readonly string[];
  readonly notices: Readonly<Record<Notice, string>>;
}

const ENGLISH: SetupTexts = {
  pageTitle: "Seluna setup",
  languageLabel: "Language",
  loginHeading: "Sign in",
  loginIntro: "Enter the SELUNA_SECRET of this instance to open the setup.",
  secretLabel: "SELUNA_SECRET",
  loginButton: "Sign in",
  startHeading: "You are signed in",
  startBody: "Set up your instance step by step:",
  logoutButton: "Sign out",
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
  notConfiguredHeading: "SELUNA_SECRET is not set",
  notConfiguredParagraphs: [
    "The setup cannot start because the Worker secret SELUNA_SECRET is missing or shorter than 32 characters.",
    "Create a random string of at least 32 characters, for example with a password manager or with: openssl rand -hex 32",
    "In the Cloudflare dashboard open this Worker, then Settings, then Variables and Secrets, and add a secret named SELUNA_SECRET with that string. Or run: npx wrangler secret put SELUNA_SECRET",
    "Then reload this page.",
  ],
  notices: {
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
    "telegram-wrong-code": "The code does not match the test message. Check the code in your chat and enter it again.",
    "telegram-code-expired":
      "The code has expired or the form is no longer valid. Search for chats again and send a new test message.",
  },
};

const GERMAN: SetupTexts = {
  pageTitle: "Seluna-Einrichtung",
  languageLabel: "Sprache",
  loginHeading: "Anmelden",
  loginIntro: "Gib das SELUNA_SECRET dieser Instanz ein, um die Einrichtung zu öffnen.",
  secretLabel: "SELUNA_SECRET",
  loginButton: "Anmelden",
  startHeading: "Du bist angemeldet",
  startBody: "Richte deine Instanz Schritt für Schritt ein:",
  logoutButton: "Abmelden",
  telegramHeading: "Telegram-Chat",
  telegramIntro:
    "Seluna sendet seine Benachrichtigungen an einen Telegram-Chat. Öffne deinen Bot in Telegram und sende /start, oder füge den Bot einer Gruppe hinzu. Suche danach nach Chats.",
  telegramSearchLink: "Nach Chats suchen",
  telegramChatIdSecret:
    "Der Chat wird durch das Worker-Secret TELEGRAM_CHAT_ID festgelegt, das Vorrang vor einem hier gewählten Chat hat. Um den Chat hier zu wählen, lösche dieses Secret.",
  telegramSavedChat: "Gespeicherter Chat:",
  telegramNoSavedChat: "Es ist noch kein Chat gespeichert.",
  telegramChatsIntro:
    "Chats, die dein Bot kürzlich gesehen hat. Jeder, der deinem Bot schreibt, erscheint hier. Wähle deshalb nur deinen eigenen Chat: Seluna sendet eine Testnachricht mit einem Code dorthin, und der Chat wird gespeichert, sobald du diesen Code eingibst.",
  telegramNoChats:
    "Kein Chat gefunden. Sende deinem Bot /start oder füge ihn einer Gruppe hinzu und suche dann erneut. Telegram hält Nachrichten an den Bot 24 Stunden vor, und Seluna sieht nur die neuesten 100: Wenn dein Bot viele Nachrichten erhält, sende kurz vor der Suche erneut /start.",
  telegramPrivateChat: "Privatchat",
  telegramGroup: "Gruppe",
  telegramConfirmButton: "Testnachricht senden",
  telegramTestMessage:
    "Seluna-Einrichtung: Um die Benachrichtigungen deiner Instanz an diesen Chat zu senden, gib diesen Code auf deiner Einrichtungsseite ein. Wenn du ihn nicht angefordert hast, ignoriere diese Nachricht. Code:",
  telegramCodeSent: "Testnachricht gesendet an Chat:",
  telegramCodeIntro:
    "Gib den sechsstelligen Code aus dieser Nachricht ein, um den Chat zu speichern. Ist keine Nachricht angekommen, ist der Chat nicht deiner: Suche erneut und wähle einen anderen.",
  telegramCodeLabel: "Code",
  telegramCodeButton: "Chat speichern",
  notConfiguredHeading: "SELUNA_SECRET ist nicht gesetzt",
  notConfiguredParagraphs: [
    "Die Einrichtung kann nicht starten, weil das Worker-Secret SELUNA_SECRET fehlt oder kürzer als 32 Zeichen ist.",
    "Erzeuge eine zufällige Zeichenfolge mit mindestens 32 Zeichen, zum Beispiel mit einem Passwortmanager oder mit: openssl rand -hex 32",
    "Öffne im Cloudflare-Dashboard diesen Worker, dann Settings, dann Variables and Secrets, und füge ein Secret namens SELUNA_SECRET mit dieser Zeichenfolge hinzu. Oder führe aus: npx wrangler secret put SELUNA_SECRET",
    "Lade danach diese Seite neu.",
  ],
  notices: {
    "wrong-secret": "Das ist nicht das SELUNA_SECRET dieser Instanz.",
    locked:
      "Zu viele fehlgeschlagene Versuche. Die Anmeldung ist nach dem fünften fehlgeschlagenen Versuch 15 Minuten lang gesperrt; versuche es später erneut.",
    "form-expired": "Das Formular ist abgelaufen. Bitte sende es erneut ab.",
    unavailable: "Die Einrichtung ist gerade nicht verfügbar. Bitte versuche es gleich noch einmal.",
    "telegram-token-missing":
      "Das Worker-Secret TELEGRAM_BOT_TOKEN ist nicht gesetzt. Sende in Telegram /newbot an @BotFather und kopiere den zurückgegebenen Token. Öffne im Cloudflare-Dashboard diesen Worker, dann Settings, dann Variables and Secrets, und füge ein Secret namens TELEGRAM_BOT_TOKEN mit diesem Token hinzu. Oder führe aus: npx wrangler secret put TELEGRAM_BOT_TOKEN",
    "telegram-token-malformed":
      "Das Worker-Secret TELEGRAM_BOT_TOKEN ist kein Bot-Token. Ein Token von @BotFather besteht aus Ziffern, einem Doppelpunkt und dann Buchstaben, Ziffern, - und _, ohne Leerzeichen. Kopiere ihn erneut von @BotFather und ersetze das Secret im Cloudflare-Dashboard unter Settings, dann Variables and Secrets.",
    "telegram-token-rejected":
      "Telegram akzeptiert das Worker-Secret TELEGRAM_BOT_TOKEN nicht: Es ist falsch geschrieben oder wurde widerrufen. Sende /mybots an @BotFather, kopiere den aktuellen Token deines Bots und ersetze das Secret im Cloudflare-Dashboard unter Settings, dann Variables and Secrets.",
    "telegram-conflict":
      "Telegram gibt die Chats des Bots nicht an Seluna weiter, weil ein anderes Programm seine Updates empfängt (ein Webhook oder ein Programm, das den Bot abfragt). Seluna braucht einen eigenen Bot: Erstelle mit /newbot bei @BotFather einen, oder entferne den Webhook dieses Bots.",
    "telegram-unavailable":
      "Telegram war nicht erreichbar oder hat eine Antwort gegeben, die Seluna nicht lesen kann. Bitte versuche es gleich noch einmal.",
    "telegram-send-failed":
      "Die Testnachricht konnte nicht gesendet werden, daher wurde der Chat nicht gespeichert. Prüfe, ob der Bot noch im Chat ist und nicht blockiert wurde, und suche dann erneut.",
    "telegram-invalid-chat": "Bitte wähle einen Chat aus der Liste.",
    "telegram-wrong-code":
      "Der Code passt nicht zur Testnachricht. Prüfe den Code in deinem Chat und gib ihn erneut ein.",
    "telegram-code-expired":
      "Der Code ist abgelaufen oder das Formular ist nicht mehr gültig. Suche erneut nach Chats und sende eine neue Testnachricht.",
  },
};

/** The texts of every page in each language. */
export const TEXTS: Readonly<Record<Language, SetupTexts>> = { en: ENGLISH, de: GERMAN };
