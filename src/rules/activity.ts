import type { OwnerAccount } from "../github/owner";
import { isForeignSender } from "./issue";
import { recordField, stringField } from "./pull-request";
import type { WebhookPayload } from "./rule";

/** The foreign account behind a star or a fork. */
export interface ActivityActor {
  readonly id: number;
  readonly login: string;
}

/**
 * The sender of `payload` when it is a foreign account (not the owner, not a bot) with a safe-integer id and a
 * string login; otherwise `undefined`.
 */
export function foreignActorOf(payload: WebhookPayload, owner: OwnerAccount | undefined): ActivityActor | undefined {
  const sender = recordField(payload, "sender");
  const login = sender === undefined ? undefined : stringField(sender, "login");
  const id = sender?.id;
  if (login === undefined || typeof id !== "number" || !isForeignSender(payload, owner)) {
    return undefined;
  }
  return { id, login };
}

/** The repository a star or a fork happened in. */
export interface ActivityRepository {
  readonly id: number;
  readonly fullName: string;
  /** `html_url` of the repository; empty when it is not a string. */
  readonly url: string;
  /** The `stargazers_count` when it is a valid count (0 up to 2^53 - 1), otherwise `undefined`. */
  readonly starCount: number | undefined;
}

/** The repository of `payload` when it has a safe-integer `id` and a string `full_name`; otherwise `undefined`. */
export function activityRepositoryOf(payload: WebhookPayload): ActivityRepository | undefined {
  const repository = recordField(payload, "repository");
  if (repository === undefined) {
    return undefined;
  }
  const { id, stargazers_count: count } = repository;
  const fullName = stringField(repository, "full_name");
  if (typeof id !== "number" || !Number.isSafeInteger(id) || fullName === undefined) {
    return undefined;
  }
  return {
    id,
    fullName,
    url: stringField(repository, "html_url") ?? "",
    starCount: typeof count === "number" && Number.isSafeInteger(count) && count >= 0 ? count : undefined,
  };
}
