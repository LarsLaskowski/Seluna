import { MESSAGE_TEXTS } from "../i18n/messages";
import { activityRepositoryOf, foreignActorOf } from "./activity";
import { recordField, stringField } from "./pull-request";
import type { Rule } from "./rule";

/** Reports a repository forked by another account (event `fork`). */
export const REPOSITORY_FORKED: Rule = {
  id: "repository_forked",
  evaluate: (event, payload, settings, owner) => {
    if (event !== "fork" || payload.action !== undefined) {
      return undefined;
    }
    const actor = foreignActorOf(payload, owner);
    const repository = activityRepositoryOf(payload);
    const forkee = recordField(payload, "forkee");
    const forkName = forkee === undefined ? undefined : stringField(forkee, "full_name");
    const forkUrl = forkee === undefined ? undefined : stringField(forkee, "html_url");
    if (actor === undefined || repository === undefined || forkName === undefined || forkUrl === undefined) {
      return undefined;
    }
    const texts = MESSAGE_TEXTS[settings.language];
    return {
      title: texts.repositoryForked,
      repository: repository.fullName,
      number: undefined,
      subject: forkName,
      context: texts.byAuthor(actor.login),
      url: forkUrl,
      activity: {
        kind: "fork",
        senderId: actor.id,
        senderLogin: actor.login,
        repositoryId: repository.id,
        repository: repository.fullName,
        repositoryUrl: repository.url,
        starCount: undefined,
      },
    };
  },
};
