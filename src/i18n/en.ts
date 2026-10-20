import type { MessageTexts } from "./messages";

export const EN: MessageTexts = {
  openOnGitHub: "Open on GitHub",
  pullRequestOpened: "New pull request",
  pullRequestReadyForReview: "Ready for review",
  pullRequestReviewRequested: "Review requested",
  ciFailedDefaultBranch: (branch) => `CI failed on ${branch}`,
  ciFailedPullRequest: "CI failed in pull request",
  ciFailedPullRequestDraftUnknown: "CI failed in pull request (draft status unknown)",
  pullRequestContext: (author, head, base) => `by ${author} · ${head} → ${base}`,
};
