import type { Rule } from "./rule";

/** Reports a new or reopened secret scanning alert; reads only the allow-listed fields, never the secret. */
export const SECRET_SCANNING_ALERT: Rule = {
  id: "secret_scanning_alert",
  evaluate: () => {
    throw new Error("Not implemented");
  },
};
