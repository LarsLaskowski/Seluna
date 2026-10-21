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
  pullRequestContext: (author, head, base) => `von ${author} · ${head} → ${base}`,
  newSelunaRelease: "Neue Seluna-Version",
  releaseAvailable: (latest, running) => `Version ${latest} ist verfügbar; diese Instanz läuft mit ${running}.`,
};
