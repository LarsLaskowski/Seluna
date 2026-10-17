import { expect, it } from "vitest";
import { MESSAGE_TEXTS } from "./messages";
import type { MessageTexts } from "./messages";

it("MESSAGE_TEXTS labels the button Open on GitHub in en and Auf GitHub öffnen in de", () => {
  expect(MESSAGE_TEXTS.en.openOnGitHub, "English label").toBe("Open on GitHub");
  expect(MESSAGE_TEXTS.de.openOnGitHub, "German label").toBe("Auf GitHub öffnen");
});

it("a text table without openOnGitHub is a type error", () => {
  // @ts-expect-error -- a table must have every key
  const incomplete: MessageTexts = {};

  expect(Object.keys(incomplete), "keys of the incomplete table").toEqual([]);
});
