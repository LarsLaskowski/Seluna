import { describe, expect, it } from "vitest";
import { groupDigits, MESSAGE_TEXTS } from "./messages";
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

it("MESSAGE_TEXTS holds the star and fork titles and the digest title in en and de", () => {
  const { en, de } = MESSAGE_TEXTS;

  expect([en.repositoryStarred, en.repositoryForked, en.activityDigestTitle], "English titles").toEqual([
    "New star",
    "New fork",
    "New stars and forks",
  ]);
  expect([de.repositoryStarred, de.repositoryForked, de.activityDigestTitle], "German titles").toEqual([
    "Neuer Stern",
    "Neuer Fork",
    "Neue Sterne und Forks",
  ]);
});

it.each([
  { language: "en", count: 0, text: "0 stars now" },
  { language: "en", count: 1, text: "1 star now" },
  { language: "en", count: 2, text: "2 stars now" },
  { language: "en", count: 1234, text: "1,234 stars now" },
  { language: "en", count: 1_234_567, text: "1,234,567 stars now" },
  { language: "de", count: 0, text: "jetzt 0 Sterne" },
  { language: "de", count: 1, text: "jetzt 1 Stern" },
  { language: "de", count: 2, text: "jetzt 2 Sterne" },
  { language: "de", count: 1234, text: "jetzt 1.234 Sterne" },
  { language: "de", count: 1_234_567, text: "jetzt 1.234.567 Sterne" },
] as const)("MESSAGE_TEXTS starsNow writes $count in $language as '$text'", ({ language, count, text }) => {
  expect(MESSAGE_TEXTS[language].starsNow(count), "line 3").toBe(text);
});

it.each([
  { language: "en", added: 1, total: undefined, text: "+1 ⭐" },
  { language: "en", added: 50, total: 1284, text: "+50 ⭐ (now 1,284)" },
  { language: "en", added: 1, total: 1234, text: "+1 ⭐ (now 1,234)" },
  { language: "en", added: 1234, total: 12_345, text: "+1,234 ⭐ (now 12,345)" },
  { language: "en", added: 1, total: 0, text: "+1 ⭐ (now 0)" },
  { language: "de", added: 1, total: undefined, text: "+1 ⭐" },
  { language: "de", added: 50, total: 1284, text: "+50 ⭐ (jetzt 1.284)" },
  { language: "de", added: 1, total: 1234, text: "+1 ⭐ (jetzt 1.234)" },
] as const)(
  "MESSAGE_TEXTS digestStars writes $added and $total in $language as '$text'",
  ({ language, added, total, text }) => {
    expect(MESSAGE_TEXTS[language].digestStars(added, total), "star part").toBe(text);
  },
);

it.each([
  { language: "en", added: 1, text: "+1 fork" },
  { language: "en", added: 2, text: "+2 forks" },
  { language: "en", added: 1234, text: "+1,234 forks" },
  { language: "de", added: 1, text: "+1 Fork" },
  { language: "de", added: 2, text: "+2 Forks" },
  { language: "de", added: 1234, text: "+1.234 Forks" },
] as const)("MESSAGE_TEXTS digestForks writes $added in $language as '$text'", ({ language, added, text }) => {
  expect(MESSAGE_TEXTS[language].digestForks(added), "fork part").toBe(text);
});

it.each([
  { language: "en", count: 46, text: "and 46 more" },
  { language: "en", count: 1, text: "and 1 more" },
  { language: "en", count: 1234, text: "and 1,234 more" },
  { language: "de", count: 46, text: "und 46 weitere" },
  { language: "de", count: 1, text: "und 1 weitere" },
  { language: "de", count: 1234, text: "und 1.234 weitere" },
] as const)("MESSAGE_TEXTS moreNames writes $count in $language as '$text'", ({ language, count, text }) => {
  expect(MESSAGE_TEXTS[language].moreNames(count).trim(), "names tail").toBe(text);
});

it.each([
  { language: "en", count: 3, text: "and 3 more repositories" },
  { language: "en", count: 12_345, text: "and 12,345 more repositories" },
  { language: "de", count: 3, text: "und 3 weitere Repositories" },
  { language: "de", count: 12_345, text: "und 12.345 weitere Repositories" },
] as const)("MESSAGE_TEXTS moreRepositories writes $count in $language as '$text'", ({ language, count, text }) => {
  expect(MESSAGE_TEXTS[language].moreRepositories(count), "last line").toBe(text);
});

describe("groupDigits", () => {
  it.each([
    { value: 0, separator: ",", text: "0" },
    { value: 7, separator: ",", text: "7" },
    { value: 999, separator: ",", text: "999" },
    { value: 1000, separator: ",", text: "1,000" },
    { value: 1234, separator: ".", text: "1.234" },
    { value: 12_345, separator: ",", text: "12,345" },
    { value: 100_000, separator: ",", text: "100,000" },
    { value: 1_234_567, separator: ".", text: "1.234.567" },
    { value: 10_000, separator: "", text: "10000" },
    { value: Number.MAX_SAFE_INTEGER, separator: ",", text: "9,007,199,254,740,991" },
  ])("groupDigits writes $value with '$separator' as '$text'", ({ value, separator, text }) => {
    expect(groupDigits(value, separator), "grouped").toBe(text);
  });
});
