import { groupDigits } from "./digits";
import type { MessageTexts } from "./messages";

/** The separator between groups of three digits. */
const SEPARATOR = ".";

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
  starsNow: (count) => `jetzt ${groupDigits(count, SEPARATOR)} ${count === 1 ? "Stern" : "Sterne"}`,
  digestStars: (added, total) => {
    const gained = `+${groupDigits(added, SEPARATOR)} ⭐`;
    return total === undefined ? gained : `${gained} (jetzt ${groupDigits(total, SEPARATOR)})`;
  },
  digestForks: (added) => `+${groupDigits(added, SEPARATOR)} ${added === 1 ? "Fork" : "Forks"}`,
  moreNames: (count) => `und ${groupDigits(count, SEPARATOR)} weitere`,
  moreRepositories: (count) => `und ${groupDigits(count, SEPARATOR)} weitere Repositories`,
  newSelunaRelease: "Neue Seluna-Version",
  releaseAvailable: (latest, running) => `Version ${latest} ist verfügbar; diese Instanz läuft mit ${running}.`,
};
