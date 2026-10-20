import { MESSAGE_TEXTS } from "../i18n/messages";
import type { Rule } from "./rule";
import { failedWorkflowRun, pullRequestRefOf } from "./workflow-run";

/** Reports a failed or timed-out workflow run of a pull request, subject to its draft check. */
export const CI_FAILED_PULL_REQUEST: Rule = {
  id: "ci_failed_pull_request",
  evaluate: (event, payload, settings) => {
    const run = failedWorkflowRun(event, payload);
    if (run === undefined || run.onDefaultBranch || run.pullRequestNumber === undefined) {
      return undefined;
    }
    const texts = MESSAGE_TEXTS[settings.language];
    return {
      title: texts.ciFailedPullRequest,
      repository: run.repository,
      number: run.pullRequestNumber,
      subject: run.workflow,
      context: run.context,
      url: run.url,
      draftCheck: {
        pullRequest: pullRequestRefOf(run.repository, run.pullRequestNumber),
        titleWhenUnknown: texts.ciFailedPullRequestDraftUnknown,
      },
    };
  },
};
