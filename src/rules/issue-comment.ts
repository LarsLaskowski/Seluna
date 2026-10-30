import { MESSAGE_TEXTS } from "../i18n/messages";
import { authorContext, commentOf, isForeignSender, issueOf } from "./issue";
import type { Rule } from "./rule";

/** Reports a comment by another account on an issue. */
export const ISSUE_COMMENT: Rule = {
  id: "issue_comment",
  evaluate: (event, payload, settings, owner) => {
    if (event !== "issue_comment" || payload.action !== "created") {
      return undefined;
    }
    const issue = issueOf(payload);
    const comment = commentOf(payload);
    if (issue?.target.kind !== "issue" || comment === undefined || !isForeignSender(payload, owner)) {
      return undefined;
    }
    const texts = MESSAGE_TEXTS[settings.language];
    return {
      title: texts.issueComment,
      repository: issue.repository,
      number: issue.number,
      subject: issue.title,
      context: authorContext(texts, comment.author, comment.body),
      url: comment.url,
    };
  },
};
