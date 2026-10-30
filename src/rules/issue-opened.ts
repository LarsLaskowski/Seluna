import type { Rule } from "./rule";

/** Reports an issue opened by another account. */
export const ISSUE_OPENED: Rule = {
  id: "issue_opened",
  evaluate: () => {
    throw new Error("Not implemented");
  },
};
