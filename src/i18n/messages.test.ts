import { expect, it } from "vitest";
import { MESSAGE_TEXTS } from "./messages";
import type { MessageTexts } from "./messages";

it("MESSAGE_TEXTS labels the button Open on GitHub in en and Auf GitHub öffnen in de", () => {
  expect(MESSAGE_TEXTS.en.openOnGitHub, "English label").toBe("Open on GitHub");
  expect(MESSAGE_TEXTS.de.openOnGitHub, "German label").toBe("Auf GitHub öffnen");
});

it("MESSAGE_TEXTS holds the pull request titles and line 3 in en and de", () => {
  const { en, de } = MESSAGE_TEXTS;

  expect(en.pullRequestOpened, "en opened").toBe("New pull request");
  expect(en.pullRequestReadyForReview, "en ready_for_review").toBe("Ready for review");
  expect(en.pullRequestReviewRequested, "en review_requested").toBe("Review requested");
  expect(en.pullRequestContext("a", "h", "b"), "en line 3").toBe("by a · h → b");
  expect(de.pullRequestOpened, "de opened").toBe("Neuer Pull Request");
  expect(de.pullRequestReadyForReview, "de ready_for_review").toBe("Bereit zum Review");
  expect(de.pullRequestReviewRequested, "de review_requested").toBe("Review angefordert");
  expect(de.pullRequestContext("a", "h", "b"), "de line 3").toBe("von a · h → b");
});

it("a text table without openOnGitHub is a type error", () => {
  // @ts-expect-error -- a table must have every key
  const incomplete: MessageTexts = {};

  expect(Object.keys(incomplete), "keys of the incomplete table").toEqual([]);
});
