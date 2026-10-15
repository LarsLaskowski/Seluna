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

const EMPTY_TEXTS: SetupTexts = {
  pageTitle: "",
  languageLabel: "",
  loginHeading: "",
  loginIntro: "",
  secretLabel: "",
  loginButton: "",
  startHeading: "",
  startBody: "",
  logoutButton: "",
  notConfiguredHeading: "",
  notConfiguredParagraphs: [],
  notices: { "wrong-secret": "", locked: "", "form-expired": "", unavailable: "" },
};

/** The texts of every page in each language (filled in by the implementation). */
export const TEXTS: Readonly<Record<Language, SetupTexts>> = { en: EMPTY_TEXTS, de: EMPTY_TEXTS };
