import type { Language } from "../setup/language";
import { DE } from "./de";
import { EN } from "./en";

export interface MessageTexts {
  /** Label of the inline button that opens the case on GitHub. */
  readonly openOnGitHub: string;
  /** Title of the case `pull_request` `opened`. */
  readonly pullRequestOpened: string;
  /** Title of the case `pull_request` `ready_for_review`. */
  readonly pullRequestReadyForReview: string;
  /** Title of the case `pull_request` `review_requested`. */
  readonly pullRequestReviewRequested: string;
  /** Line 3 of a pull request notification: the author and the branches. */
  readonly pullRequestContext: (author: string, head: string, base: string) => string;
}

export const MESSAGE_TEXTS: Readonly<Record<Language, MessageTexts>> = { en: EN, de: DE };
