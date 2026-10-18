import type { Rule } from "./rule";

/** Reports a non-draft pull request that was opened. */
export const PULL_REQUEST_OPENED: Rule = {
  id: "pull_request_opened",
  evaluate: () => {
    throw new Error("Not implemented");
  },
};
