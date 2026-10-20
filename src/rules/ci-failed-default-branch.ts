import { MESSAGE_TEXTS } from "../i18n/messages";
import type { Rule } from "./rule";
import { failedWorkflowRun } from "./workflow-run";

/** Reports a failed or timed-out workflow run on the default branch of the repository itself. */
export const CI_FAILED_DEFAULT_BRANCH: Rule = {
  id: "ci_failed_default_branch",
  evaluate: (event, payload, settings) => {
    const run = failedWorkflowRun(event, payload);
    if (run?.onDefaultBranch !== true) {
      return undefined;
    }
    return {
      title: MESSAGE_TEXTS[settings.language].ciFailedDefaultBranch(run.branch),
      repository: run.repository,
      number: undefined,
      subject: run.workflow,
      context: run.context,
      url: run.url,
    };
  },
};
