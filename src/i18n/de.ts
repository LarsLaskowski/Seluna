import type { MessageTexts } from "./messages";

export const DE: MessageTexts = {
  openOnGitHub: "Auf GitHub öffnen",
  pullRequestOpened: "Neuer Pull Request",
  pullRequestReadyForReview: "Bereit zum Review",
  pullRequestReviewRequested: "Review angefordert",
  ciFailedDefaultBranch: (branch) => `CI fehlgeschlagen auf ${branch}`,
  ciFailedPullRequest: "CI im Pull Request fehlgeschlagen",
  ciFailedPullRequestDraftUnknown: "CI im Pull Request fehlgeschlagen (Draft-Status unbekannt)",
  pullRequestContext: (author, head, base) => `von ${author} · ${head} → ${base}`,
};
