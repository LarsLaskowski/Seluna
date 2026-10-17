import type { Language } from "../setup/language";
import { DE } from "./de";
import { EN } from "./en";

export interface MessageTexts {
  /** Label of the inline button that opens the case on GitHub. */
  readonly openOnGitHub: string;
}

export const MESSAGE_TEXTS: Readonly<Record<Language, MessageTexts>> = { en: EN, de: DE };
