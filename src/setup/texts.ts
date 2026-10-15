import type { Language } from "./language";

export type Notice = "wrong-secret" | "locked" | "form-expired" | "unavailable";

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
  startBody: "The setup steps follow in a later version.",
  logoutButton: "Sign out",
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
  startBody: "Die Einrichtungsschritte folgen in einer späteren Version.",
  logoutButton: "Abmelden",
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
  },
};

/** The texts of every page in each language. */
export const TEXTS: Readonly<Record<Language, SetupTexts>> = { en: ENGLISH, de: GERMAN };
