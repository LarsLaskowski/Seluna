import type { Rule } from "./rule";

/** Reports a comment by another account on a non-draft pull request. */
export const PULL_REQUEST_COMMENT: Rule = {
  id: "pull_request_comment",
  evaluate: () => {
    throw new Error("Not implemented");
  },
};
