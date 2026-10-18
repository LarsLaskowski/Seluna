import type { MessageTexts } from "./messages";

export const DE: MessageTexts = {
  openOnGitHub: "Auf GitHub öffnen",
  pullRequestOpened: "Neuer Pull Request",
  pullRequestReadyForReview: "Bereit zum Review",
  pullRequestReviewRequested: "Review angefordert",
  pullRequestContext: (author, head, base) => `von ${author} · ${head} → ${base}`,
};
