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
  /** Title of a failed run on the default branch. */
  readonly ciFailedDefaultBranch: (branch: string) => string;
  /** Title of a failed run in a pull request. */
  readonly ciFailedPullRequest: string;
  /** Title of a failed run in a pull request whose draft state could not be read. */
  readonly ciFailedPullRequestDraftUnknown: string;
  /** Title of a Dependabot alert. */
  readonly dependabotAlert: string;
  /** Title of a code scanning alert. */
  readonly codeScanningAlert: string;
  /** Title of a secret scanning alert. */
  readonly secretScanningAlert: string;
  /** Title of a new issue. */
  readonly issueOpened: string;
  /** Title of a new comment on an issue. */
  readonly issueComment: string;
  /** Title of a new comment on a pull request. */
  readonly pullRequestComment: string;
  /** The author part of line 3 of an issue or comment notification. */
  readonly byAuthor: (author: string) => string;
  /** Line 3 of a pull request notification: the author and the branches. */
  readonly pullRequestContext: (author: string, head: string, base: string) => string;
  /** Title of a new star. */
  readonly repositoryStarred: string;
  /** Title of a new fork. */
  readonly repositoryForked: string;
  /** Line 3 of a star notification: the repository's star count now. */
  readonly starsNow: (count: number) => string;
  /** Title of the activity digest. */
  readonly activityDigestTitle: string;
  /** The star part of a digest line: the new stars and the total when known. */
  readonly digestStars: (added: number, total: number | undefined) => string;
  /** The fork part of a digest line. */
  readonly digestForks: (added: number) => string;
  /** The tail of a digest line's names: the number of names left out. */
  readonly moreNames: (count: number) => string;
  /** The last digest line: the number of repositories left out. */
  readonly moreRepositories: (count: number) => string;
  /** Title of the notice that a new Seluna release is available. */
  readonly newSelunaRelease: string;
  /** Line 2 of the release notice: the latest and the running version, as `A.B.C`. */
  readonly releaseAvailable: (latest: string, running: string) => string;
}

export const MESSAGE_TEXTS: Readonly<Record<Language, MessageTexts>> = { en: EN, de: DE };

/** `value` in decimal with `separator` between the groups of three digits. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- skeleton
export function groupDigits(value: number, separator: string): string {
  throw new Error("not implemented");
}
