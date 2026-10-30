import type { MessageTexts } from "./messages";

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
  newSelunaRelease: "New Seluna release",
  releaseAvailable: (latest, running) => `Version ${latest} is available; this instance runs ${running}.`,
};
