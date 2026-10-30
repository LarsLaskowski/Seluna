import type { Rule } from "./rule";

/** Reports a comment by another account on an issue. */
export const ISSUE_COMMENT: Rule = {
  id: "issue_comment",
  evaluate: () => {
    throw new Error("Not implemented");
  },
};
