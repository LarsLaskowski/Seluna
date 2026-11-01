import type { OwnerAccount } from "../github/owner";
import { MESSAGE_TEXTS } from "../i18n/messages";
import type { NotificationSettings } from "../settings";
import { activityRepositoryOf, foreignActorOf } from "./activity";
import type { Rule, StarRemoval, WebhookPayload } from "./rule";

/** Reports a repository starred by another account (event `star`, action `created`). */
export const REPOSITORY_STARRED: Rule = {
  id: "repository_starred",
  evaluate: (event, payload, settings, owner) => {
    if (event !== "star" || payload.action !== "created") {
      return undefined;
    }
    const actor = foreignActorOf(payload, owner);
    const repository = activityRepositoryOf(payload);
    if (actor === undefined || repository === undefined) {
      return undefined;
    }
    const texts = MESSAGE_TEXTS[settings.language];
    return {
      title: texts.repositoryStarred,
      repository: repository.fullName,
      number: undefined,
      subject: texts.byAuthor(actor.login),
      context: repository.starCount === undefined ? "" : texts.starsNow(repository.starCount),
      url: repository.url,
      activity: {
        kind: "star",
        senderId: actor.id,
        senderLogin: actor.login,
        repositoryId: repository.id,
        repository: repository.fullName,
        repositoryUrl: repository.url,
        starCount: repository.starCount,
      },
    };
  },
};

/**
 * The removal of a star taken back by a foreign account (event `star`, action `deleted`, the rule's switch on);
 * otherwise `undefined`.
 */
export function starRemovalOf(
  event: string,
  payload: WebhookPayload,
  settings: NotificationSettings,
  owner: OwnerAccount | undefined,
): StarRemoval | undefined {
  if (event !== "star" || payload.action !== "deleted" || !settings.rules.repository_starred) {
    return undefined;
  }
  const actor = foreignActorOf(payload, owner);
  const repository = activityRepositoryOf(payload);
  return actor === undefined || repository === undefined
    ? undefined
    : { senderId: actor.id, repositoryId: repository.id };
}
