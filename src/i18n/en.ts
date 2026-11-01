import { groupDigits } from "./digits";
import type { MessageTexts } from "./messages";

/** The separator between groups of three digits. */
const SEPARATOR = ",";

export const EN: MessageTexts = {
  openOnGitHub: "Open on GitHub",
  pullRequestOpened: "New pull request",
  pullRequestReadyForReview: "Ready for review",
  pullRequestReviewRequested: "Review requested",
  ciFailedDefaultBranch: (branch) => `CI failed on ${branch}`,
  ciFailedPullRequest: "CI failed in pull request",
  ciFailedPullRequestDraftUnknown: "CI failed in pull request (draft status unknown)",
  dependabotAlert: "Dependabot alert",
  codeScanningAlert: "Code scanning alert",
  secretScanningAlert: "Secret scanning alert",
  issueOpened: "New issue",
  issueComment: "New comment on issue",
  pullRequestComment: "New comment on pull request",
  byAuthor: (author) => `by ${author}`,
  pullRequestContext: (author, head, base) => `by ${author} · ${head} → ${base}`,
  repositoryStarred: "New star",
  repositoryForked: "New fork",
  activityDigestTitle: "New stars and forks",
  starsNow: (count) => `${groupDigits(count, SEPARATOR)} ${count === 1 ? "star" : "stars"} now`,
  digestStars: (added, total) => {
    const gained = `+${groupDigits(added, SEPARATOR)} ⭐`;
    return total === undefined ? gained : `${gained} (now ${groupDigits(total, SEPARATOR)})`;
  },
  digestForks: (added) => `+${groupDigits(added, SEPARATOR)} ${added === 1 ? "fork" : "forks"}`,
  moreNames: (count) => `and ${groupDigits(count, SEPARATOR)} more`,
  moreRepositories: (count) => `and ${groupDigits(count, SEPARATOR)} more repositories`,
  newSelunaRelease: "New Seluna release",
  releaseAvailable: (latest, running) => `Version ${latest} is available; this instance runs ${running}.`,
};
