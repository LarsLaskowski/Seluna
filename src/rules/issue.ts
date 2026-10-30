import type { OwnerAccount } from "../github/owner";
import type { MessageTexts } from "../i18n/messages";
import type { WebhookPayload } from "./rule";

/** What an `issue` object is: a plain issue, or a pull request with its draft state when the payload has one. */
export type IssueKind =
  { readonly kind: "issue" } | { readonly kind: "pull-request"; readonly draft: boolean | undefined };

/** The fields of an `issues` or `issue_comment` delivery's `issue` the rules read, narrowed. */
export interface IssueFields {
  /** `repository.full_name`. */
  readonly repository: string;
  /** `issue.number`, a whole number from 1 to 2^53 - 1. */
  readonly number: number;
  /** `issue.title`. */
  readonly title: string;
  /** `issue.html_url`. */
  readonly url: string;
  /** `issue.user.login`. */
  readonly author: string;
  /** `issue.body`; `undefined` when null or absent. */
  readonly body: string | undefined;
  /** Whether the issue is a pull request, and its draft state. */
  readonly target: IssueKind;
}

/** The fields of a `comment` the rules read, narrowed. */
export interface CommentFields {
  /** `comment.html_url`. */
  readonly url: string;
  /** `comment.user.login`. */
  readonly author: string;
  /** `comment.body`. */
  readonly body: string | undefined;
}

/** Whether the sender is a well-formed account other than the owner and not a bot. */
export function isForeignSender(payload: WebhookPayload, owner: OwnerAccount | undefined): boolean {
  void payload;
  void owner;
  throw new Error("Not implemented");
}

/** The narrowed `issue` of the delivery, or `undefined` for any malformed shape. */
export function issueOf(payload: WebhookPayload): IssueFields | undefined {
  void payload;
  throw new Error("Not implemented");
}

/** The narrowed `comment` of the delivery, or `undefined` for any malformed shape. */
export function commentOf(payload: WebhookPayload): CommentFields | undefined {
  void payload;
  throw new Error("Not implemented");
}

/** Longest excerpt, in code points: one more than line 3's limit, so the store still cuts it. */
export const EXCERPT_MAX_CHARACTERS = 257;

/** The body without HTML comments, white-space runs as one space, trimmed, at most EXCERPT_MAX_CHARACTERS code points. */
export function bodyExcerpt(body: string | undefined): string {
  void body;
  throw new Error("Not implemented");
}

/** Line 3 of an issue or comment notification: the author, then the body excerpt when there is one. */
export function authorContext(texts: MessageTexts, author: string, body: string | undefined): string {
  void texts;
  void author;
  void body;
  throw new Error("Not implemented");
}
