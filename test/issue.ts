import type { OwnerAccount } from "../src/github/owner";
import type { WebhookPayload } from "../src/rules/rule";
import { ABSENT, variant } from "./pull-request";

/** The owner of the fixtures' repository (`repository.owner` of the issue and comment fixtures). */
export const OWNER: OwnerAccount = { id: 1000, login: "example-owner", type: "User" };

/** An organization owner with the id of {@link OWNER}: its id is no user's id. */
export const ORGANIZATION_OWNER: OwnerAccount = { id: 1000, login: "example-org", type: "Organization" };

/** `payload` with the owner as its `sender`. */
export function fromOwner(payload: WebhookPayload): WebhookPayload {
  return variant(payload, ["sender"], { login: "example-owner", id: 1000, type: "User" });
}

/** `payload` with a bot (Dependabot) as its `sender`. */
export function fromBot(payload: WebhookPayload): WebhookPayload {
  return variant(payload, ["sender"], { login: "dependabot[bot]", id: 49_699_333, type: "Bot" });
}

/** A field of a delivery set to a value that makes the delivery unusable. */
export interface MalformedField {
  readonly field: string;
  readonly label: string;
  readonly path: readonly string[];
  readonly value: unknown;
}

/** The senders of E8: without a numeric `id` and a string `type` owner and bots cannot be told apart. */
export const MALFORMED_SENDERS: readonly MalformedField[] = [
  { field: "sender", label: "missing", path: ["sender"], value: ABSENT },
  { field: "sender", label: "null", path: ["sender"], value: null },
  { field: "sender", label: "a string", path: ["sender"], value: "example-other-user" },
  { field: "sender", label: "an array", path: ["sender"], value: [{ id: 1_000_002, type: "User" }] },
  { field: "sender.id", label: "missing", path: ["sender", "id"], value: ABSENT },
  { field: "sender.id", label: "a string", path: ["sender", "id"], value: "1000002" },
  { field: "sender.id", label: "null", path: ["sender", "id"], value: null },
  { field: "sender.id", label: "NaN", path: ["sender", "id"], value: Number.NaN },
  { field: "sender.type", label: "missing", path: ["sender", "type"], value: ABSENT },
  { field: "sender.type", label: "a number", path: ["sender", "type"], value: 1 },
  { field: "sender.type", label: "an object", path: ["sender", "type"], value: { name: "User" } },
];

/** The shapes of E7 for the `issue` and `repository` objects of an `issues` or `issue_comment` delivery. */
export const MALFORMED_ISSUE_FIELDS: readonly MalformedField[] = [
  { field: "issue", label: "missing", path: ["issue"], value: ABSENT },
  { field: "issue", label: "null", path: ["issue"], value: null },
  { field: "issue", label: "an array", path: ["issue"], value: [] },
  { field: "issue", label: "a string", path: ["issue"], value: "issue" },
  { field: "issue.number", label: "0", path: ["issue", "number"], value: 0 },
  { field: "issue.number", label: "-1", path: ["issue", "number"], value: -1 },
  { field: "issue.number", label: "1.5", path: ["issue", "number"], value: 1.5 },
  { field: "issue.number", label: "2^53", path: ["issue", "number"], value: 2 ** 53 },
  { field: "issue.number", label: "NaN", path: ["issue", "number"], value: Number.NaN },
  { field: "issue.number", label: "a string", path: ["issue", "number"], value: "7" },
  { field: "issue.number", label: "null", path: ["issue", "number"], value: null },
  { field: "issue.number", label: "missing", path: ["issue", "number"], value: ABSENT },
  { field: "issue.title", label: "missing", path: ["issue", "title"], value: ABSENT },
  { field: "issue.title", label: "a number", path: ["issue", "title"], value: 7 },
  { field: "issue.title", label: "null", path: ["issue", "title"], value: null },
  { field: "issue.html_url", label: "missing", path: ["issue", "html_url"], value: ABSENT },
  { field: "issue.html_url", label: "a number", path: ["issue", "html_url"], value: 7 },
  { field: "issue.user", label: "missing", path: ["issue", "user"], value: ABSENT },
  { field: "issue.user.login", label: "missing", path: ["issue", "user", "login"], value: ABSENT },
  { field: "issue.user.login", label: "a number", path: ["issue", "user", "login"], value: 7 },
  { field: "issue.body", label: "a number", path: ["issue", "body"], value: 7 },
  { field: "issue.body", label: "an object", path: ["issue", "body"], value: {} },
  { field: "issue.body", label: "an array", path: ["issue", "body"], value: ["text"] },
  { field: "issue.body", label: "true", path: ["issue", "body"], value: true },
  { field: "issue.pull_request", label: "a string", path: ["issue", "pull_request"], value: "yes" },
  { field: "issue.pull_request", label: "a number", path: ["issue", "pull_request"], value: 1 },
  { field: "issue.pull_request", label: "true", path: ["issue", "pull_request"], value: true },
  { field: "issue.pull_request", label: "an array", path: ["issue", "pull_request"], value: [] },
  { field: "issue.pull_request", label: "null", path: ["issue", "pull_request"], value: null },
  { field: "issue.draft", label: "a string", path: ["issue", "draft"], value: "yes" },
  { field: "issue.draft", label: "a number", path: ["issue", "draft"], value: 42 },
  { field: "issue.draft", label: "null", path: ["issue", "draft"], value: null },
  { field: "repository", label: "missing", path: ["repository"], value: ABSENT },
  { field: "repository.full_name", label: "missing", path: ["repository", "full_name"], value: ABSENT },
  { field: "repository.full_name", label: "a number", path: ["repository", "full_name"], value: 7 },
];

/** The shapes of E7 for the `comment` object of an `issue_comment` delivery. */
export const MALFORMED_COMMENT_FIELDS: readonly MalformedField[] = [
  { field: "comment", label: "missing", path: ["comment"], value: ABSENT },
  { field: "comment", label: "null", path: ["comment"], value: null },
  { field: "comment", label: "an array", path: ["comment"], value: [] },
  { field: "comment", label: "a string", path: ["comment"], value: "comment" },
  { field: "comment.html_url", label: "missing", path: ["comment", "html_url"], value: ABSENT },
  { field: "comment.html_url", label: "a number", path: ["comment", "html_url"], value: 7 },
  { field: "comment.user", label: "missing", path: ["comment", "user"], value: ABSENT },
  { field: "comment.user.login", label: "missing", path: ["comment", "user", "login"], value: ABSENT },
  { field: "comment.user.login", label: "a number", path: ["comment", "user", "login"], value: 7 },
  { field: "comment.body", label: "a number", path: ["comment", "body"], value: 7 },
  { field: "comment.body", label: "an object", path: ["comment", "body"], value: {} },
  { field: "comment.body", label: "an array", path: ["comment", "body"], value: ["text"] },
  { field: "comment.body", label: "true", path: ["comment", "body"], value: true },
];

/** A body (or none) that gives line 3 the author alone (E5). `body` is the value set, `ABSENT` removes the field. */
export interface EmptyBody {
  readonly case: string;
  readonly body: unknown;
}

export const EMPTY_BODIES: readonly EmptyBody[] = [
  { case: "an empty body", body: "" },
  { case: "a null body", body: null },
  { case: "a missing body", body: ABSENT },
  { case: "a body of white space only", body: " \n\t " },
  { case: "a body of an HTML comment only", body: "<!-- Describe the problem here -->" },
  { case: "a body of an unterminated HTML comment only", body: "<!-- Describe the problem" },
];

/** The actions of the `issues` event other than `opened`. */
export const OTHER_ISSUES_ACTIONS: readonly string[] = [
  "edited",
  "deleted",
  "closed",
  "reopened",
  "transferred",
  "labeled",
  "some_new_action",
  "",
  "Opened",
];

/** The actions of the `issue_comment` event other than `created`. */
export const OTHER_COMMENT_ACTIONS: readonly string[] = ["edited", "deleted", "some_new_action", "", "Created"];
