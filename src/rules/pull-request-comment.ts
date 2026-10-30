import { MESSAGE_TEXTS } from "../i18n/messages";
import { authorContext, commentOf, isForeignSender, issueOf } from "./issue";
import type { Notification, Rule } from "./rule";
import { pullRequestRefOf } from "./workflow-run";

/** Reports a comment by another account on a pull request that is not a draft; an unknown draft state is looked up. */
export const PULL_REQUEST_COMMENT: Rule = {
  id: "pull_request_comment",
  evaluate: (event, payload, settings, owner) => {
    if (event !== "issue_comment" || payload.action !== "created") {
      return undefined;
    }
    const issue = issueOf(payload);
    const comment = commentOf(payload);
    if (
      issue?.target.kind !== "pull-request" ||
      issue.target.draft === true ||
      comment === undefined ||
      !isForeignSender(payload, owner)
    ) {
      return undefined;
    }
    const texts = MESSAGE_TEXTS[settings.language];
    const notification: Notification = {
      title: texts.pullRequestComment,
      repository: issue.repository,
      number: issue.number,
      subject: issue.title,
      context: authorContext(texts, comment.author, comment.body),
      url: comment.url,
    };
    return issue.target.draft === false
      ? notification
      : {
          ...notification,
          draftCheck: { pullRequest: pullRequestRefOf(issue.repository, issue.number), titleWhenUnknown: undefined },
        };
  },
};
