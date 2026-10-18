import { pullRequestRule } from "./pull-request";
import type { Rule } from "./rule";

/** Reports a non-draft pull request that was opened. */
export const PULL_REQUEST_OPENED: Rule = pullRequestRule(
  "pull_request_opened",
  "opened",
  (texts) => texts.pullRequestOpened,
);
