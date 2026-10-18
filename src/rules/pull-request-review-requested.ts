import type { Rule } from "./rule";

/** Reports a review request on a non-draft pull request. */
export const PULL_REQUEST_REVIEW_REQUESTED: Rule = {
  id: "pull_request_review_requested",
  evaluate: () => {
    throw new Error("Not implemented");
  },
};
