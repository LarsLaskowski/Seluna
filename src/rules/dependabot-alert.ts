import type { Rule } from "./rule";

/** Reports a new or reopened Dependabot alert. */
export const DEPENDABOT_ALERT: Rule = {
  id: "dependabot_alert",
  evaluate: () => {
    throw new Error("Not implemented");
  },
};
