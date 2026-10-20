import type { Rule } from "./rule";

/** Reports a failed or timed-out workflow run on the default branch of the repository itself. */
export const CI_FAILED_DEFAULT_BRANCH: Rule = {
  id: "ci_failed_default_branch",
  evaluate: () => {
    throw new Error("Not implemented");
  },
};
