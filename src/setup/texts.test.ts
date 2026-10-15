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
    expect(Object.keys(TEXTS.en.notices).length, "number of notices").toBe(4);
  });

  it("texts word the English notices as the area document does", () => {
    expect(TEXTS.en.notices, "English notices").toEqual({
      "wrong-secret": "That is not the SELUNA_SECRET of this instance.",
      locked:
        "Too many failed attempts. Signing in is locked for 15 minutes after the fifth failed attempt; try again later.",
      "form-expired": "The form has expired. Please submit it again.",
      unavailable: "The setup is unavailable right now. Please try again in a moment.",
    });
  });
});
