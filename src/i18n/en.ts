import type { MessageTexts } from "./messages";

export const EN: MessageTexts = {
  openOnGitHub: "Open on GitHub",
  pullRequestOpened: "New pull request",
  pullRequestReadyForReview: "Ready for review",
  pullRequestReviewRequested: "Review requested",
  pullRequestContext: (author, head, base) => `by ${author} · ${head} → ${base}`,
};
