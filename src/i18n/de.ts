import type { MessageTexts } from "./messages";

export const DE: MessageTexts = {
  openOnGitHub: "Auf GitHub öffnen",
  pullRequestOpened: "Neuer Pull Request",
  pullRequestReadyForReview: "Bereit zum Review",
  pullRequestReviewRequested: "Review angefordert",
  ciFailedDefaultBranch: (branch) => `CI fehlgeschlagen auf ${branch}`,
  ciFailedPullRequest: "CI im Pull Request fehlgeschlagen",
  ciFailedPullRequestDraftUnknown: "CI im Pull Request fehlgeschlagen (Draft-Status unbekannt)",
  dependabotAlert: "Dependabot-Warnung",
  codeScanningAlert: "Code-Scanning-Warnung",
  secretScanningAlert: "Secret-Scanning-Warnung",
  issueOpened: "Neues Issue",
  issueComment: "Neuer Kommentar zum Issue",
  pullRequestComment: "Neuer Kommentar zum Pull Request",
  byAuthor: (author) => `von ${author}`,
  pullRequestContext: (author, head, base) => `von ${author} · ${head} → ${base}`,
  repositoryStarred: "Neuer Stern",
  repositoryForked: "Neuer Fork",
  activityDigestTitle: "Neue Sterne und Forks",
  starsNow: () => {
    throw new Error("not implemented");
  },
  digestStars: () => {
    throw new Error("not implemented");
  },
  digestForks: () => {
    throw new Error("not implemented");
  },
  moreNames: () => {
    throw new Error("not implemented");
  },
  moreRepositories: () => {
    throw new Error("not implemented");
  },
  newSelunaRelease: "Neue Seluna-Version",
  releaseAvailable: (latest, running) => `Version ${latest} ist verfügbar; diese Instanz läuft mit ${running}.`,
};
