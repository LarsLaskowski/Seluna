import type { Rule } from "./rule";

/** Reports a repository forked by another account (event `fork`). */
export const REPOSITORY_FORKED: Rule = {
  id: "repository_forked",
  evaluate: () => undefined,
};
