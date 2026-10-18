import type { Rule } from "./rule";

/** Reports a pull request that was marked ready for review. */
export const PULL_REQUEST_READY_FOR_REVIEW: Rule = {
  id: "pull_request_ready_for_review",
  evaluate: () => {
    throw new Error("Not implemented");
  },
};
