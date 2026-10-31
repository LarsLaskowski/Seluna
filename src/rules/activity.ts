/* eslint-disable @typescript-eslint/no-unused-vars -- skeleton: the bodies arrive with the implementation */
import type { OwnerAccount } from "../github/owner";
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
  throw new Error("not implemented");
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
  throw new Error("not implemented");
}
