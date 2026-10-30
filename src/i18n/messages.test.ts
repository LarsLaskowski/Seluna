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

it("MESSAGE_TEXTS holds the CI titles and the draft-unknown title in en and de", () => {
  const { en, de } = MESSAGE_TEXTS;

  expect(en.ciFailedDefaultBranch("x"), "en default branch").toBe("CI failed on x");
  expect(en.ciFailedPullRequest, "en pull request").toBe("CI failed in pull request");
  expect(en.ciFailedPullRequestDraftUnknown, "en draft unknown").toBe(
    "CI failed in pull request (draft status unknown)",
  );
  expect(de.ciFailedDefaultBranch("x"), "de default branch").toBe("CI fehlgeschlagen auf x");
  expect(de.ciFailedPullRequest, "de pull request").toBe("CI im Pull Request fehlgeschlagen");
  expect(de.ciFailedPullRequestDraftUnknown, "de draft unknown").toBe(
    "CI im Pull Request fehlgeschlagen (Draft-Status unbekannt)",
  );
});

it("MESSAGE_TEXTS holds the security alert titles in en and de", () => {
  const { en, de } = MESSAGE_TEXTS;

  expect(en.dependabotAlert, "en Dependabot").toBe("Dependabot alert");
  expect(en.codeScanningAlert, "en code scanning").toBe("Code scanning alert");
  expect(en.secretScanningAlert, "en secret scanning").toBe("Secret scanning alert");
  expect(de.dependabotAlert, "de Dependabot").toBe("Dependabot-Warnung");
  expect(de.codeScanningAlert, "de code scanning").toBe("Code-Scanning-Warnung");
  expect(de.secretScanningAlert, "de secret scanning").toBe("Secret-Scanning-Warnung");
});

it("MESSAGE_TEXTS holds the issue and comment titles and the byAuthor prefix in en and de", () => {
  const { en, de } = MESSAGE_TEXTS;

  expect(en.issueOpened, "en issue opened").toBe("New issue");
  expect(en.issueComment, "en issue comment").toBe("New comment on issue");
  expect(en.pullRequestComment, "en pull request comment").toBe("New comment on pull request");
  expect(en.byAuthor("a"), "en by author").toBe("by a");
  expect(de.issueOpened, "de issue opened").toBe("Neues Issue");
  expect(de.issueComment, "de issue comment").toBe("Neuer Kommentar zum Issue");
  expect(de.pullRequestComment, "de pull request comment").toBe("Neuer Kommentar zum Pull Request");
  expect(de.byAuthor("a"), "de by author").toBe("von a");
});

it("MESSAGE_TEXTS has the same keys in en and de", () => {
  const { en, de } = MESSAGE_TEXTS;

  expect(
    Object.keys(de).sort((a, b) => a.localeCompare(b)),
    "keys of de",
  ).toEqual(Object.keys(en).sort((a, b) => a.localeCompare(b)));
});

it("a text table without openOnGitHub is a type error", () => {
  // @ts-expect-error -- a table must have every key
  const incomplete: MessageTexts = {};

  expect(Object.keys(incomplete), "keys of the incomplete table").toEqual([]);
});
