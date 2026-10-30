import type { OwnerAccount } from "../github/owner";
import type { MessageTexts } from "../i18n/messages";
import { isBotSender, isOwnAction } from "./actor";
import { isRecord, recordField, stringField } from "./pull-request";
import { joinContext } from "./security-alert";
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

/** A whole number from 1 to 2^53 - 1. */
function isPositiveWholeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

/** Whether the sender is a well-formed account other than the owner and not a bot. */
export function isForeignSender(payload: WebhookPayload, owner: OwnerAccount | undefined): boolean {
  const sender = recordField(payload, "sender");
  if (sender === undefined || !Number.isSafeInteger(sender.id) || typeof sender.type !== "string") {
    return false;
  }
  return !isOwnAction(payload, owner) && !isBotSender(payload);
}

/** The body: `undefined` for null or absent, `false` for any other type. */
function bodyField(record: Record<string, unknown>): string | undefined | false {
  const body = record.body;
  if (body === undefined || body === null) {
    return undefined;
  }
  return typeof body === "string" ? body : false;
}

/** The `issue` object's kind: `undefined` when `pull_request` or `draft` has a type GitHub does not send. */
function kindOf(issue: Record<string, unknown>): IssueKind | undefined {
  const pullRequest = issue.pull_request;
  if (pullRequest === undefined) {
    return { kind: "issue" };
  }
  if (!isRecord(pullRequest)) {
    return undefined;
  }
  const draft = issue.draft;
  if (draft !== undefined && typeof draft !== "boolean") {
    return undefined;
  }
  return { kind: "pull-request", draft };
}

/** The narrowed `issue` of the delivery, or `undefined` for any malformed shape. */
export function issueOf(payload: WebhookPayload): IssueFields | undefined {
  const issue = recordField(payload, "issue");
  if (issue === undefined) {
    return undefined;
  }
  const repository = stringField(recordField(payload, "repository") ?? {}, "full_name");
  const title = stringField(issue, "title");
  const url = stringField(issue, "html_url");
  const author = stringField(recordField(issue, "user") ?? {}, "login");
  const body = bodyField(issue);
  const target = kindOf(issue);
  if (
    !isPositiveWholeNumber(issue.number) ||
    repository === undefined ||
    title === undefined ||
    url === undefined ||
    author === undefined ||
    body === false ||
    target === undefined
  ) {
    return undefined;
  }
  return { repository, number: issue.number, title, url, author, body, target };
}

/** The narrowed `comment` of the delivery, or `undefined` for any malformed shape. */
export function commentOf(payload: WebhookPayload): CommentFields | undefined {
  const comment = recordField(payload, "comment");
  if (comment === undefined) {
    return undefined;
  }
  const url = stringField(comment, "html_url");
  const author = stringField(recordField(comment, "user") ?? {}, "login");
  const body = bodyField(comment);
  if (url === undefined || author === undefined || body === false) {
    return undefined;
  }
  return { url, author, body };
}

/** Longest excerpt, in code points: one more than line 3's limit, so the store still cuts it. */
export const EXCERPT_MAX_CHARACTERS = 257;

const COMMENT_OPEN = "<!--";
const COMMENT_CLOSE = "-->";
const WHITE_SPACE = /^\s$/u;

/** The body without HTML comments, white-space runs as one space, trimmed, at most EXCERPT_MAX_CHARACTERS code points. */
export function bodyExcerpt(body: string | undefined): string {
  if (body === undefined) {
    return "";
  }
  let excerpt = "";
  let count = 0;
  let pendingSpace = false;
  let index = 0;
  while (index < body.length && count < EXCERPT_MAX_CHARACTERS) {
    if (body.startsWith(COMMENT_OPEN, index)) {
      const close = body.indexOf(COMMENT_CLOSE, index + COMMENT_OPEN.length);
      if (close < 0) {
        break;
      }
      index = close + COMMENT_CLOSE.length;
      continue;
    }
    const character = String.fromCodePoint(body.codePointAt(index) ?? 0);
    index += character.length;
    if (WHITE_SPACE.test(character)) {
      pendingSpace = true;
      continue;
    }
    if (pendingSpace && count > 0) {
      excerpt += " ";
      count += 1;
    }
    pendingSpace = false;
    if (count < EXCERPT_MAX_CHARACTERS) {
      excerpt += character;
      count += 1;
    }
  }
  return excerpt;
}

/** Line 3 of an issue or comment notification: the author, then the body excerpt when there is one. */
export function authorContext(texts: MessageTexts, author: string, body: string | undefined): string {
  return joinContext([texts.byAuthor(author), bodyExcerpt(body)]);
}
