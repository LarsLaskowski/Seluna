import { MESSAGE_TEXTS } from "../i18n/messages";
import { authorContext, isForeignSender, issueOf } from "./issue";
import type { Rule } from "./rule";

/** Reports an issue opened by another account. */
export const ISSUE_OPENED: Rule = {
  id: "issue_opened",
  evaluate: (event, payload, settings, owner) => {
    if (event !== "issues" || payload.action !== "opened") {
      return undefined;
    }
    const issue = issueOf(payload);
    // An `issues` delivery never carries a comment; one that does is another event's payload.
    if (payload.comment !== undefined || issue?.target.kind !== "issue" || !isForeignSender(payload, owner)) {
      return undefined;
    }
    const texts = MESSAGE_TEXTS[settings.language];
    return {
      title: texts.issueOpened,
      repository: issue.repository,
      number: issue.number,
      subject: issue.title,
      context: authorContext(texts, issue.author, issue.body),
      url: issue.url,
    };
  },
};
