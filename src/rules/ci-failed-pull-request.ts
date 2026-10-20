import type { Rule } from "./rule";

/** Reports a failed or timed-out workflow run of a pull request, subject to its draft check. */
export const CI_FAILED_PULL_REQUEST: Rule = {
  id: "ci_failed_pull_request",
  evaluate: () => {
    throw new Error("Not implemented");
  },
};
