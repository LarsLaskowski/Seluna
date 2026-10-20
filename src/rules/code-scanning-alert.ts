import type { Rule } from "./rule";

/** Reports a new, reopened or newly appeared code scanning alert on the default branch. */
export const CODE_SCANNING_ALERT: Rule = {
  id: "code_scanning_alert",
  evaluate: () => {
    throw new Error("Not implemented");
  },
};
