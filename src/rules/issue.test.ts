import { describe, expect, it } from "vitest";
import issueCommentCreated from "../../test/fixtures/issue_comment/created.json";
import draftPullRequestComment from "../../test/fixtures/issue_comment/created-draft-pull-request.json";
import pullRequestComment from "../../test/fixtures/issue_comment/created-pull-request.json";
import issuesOpened from "../../test/fixtures/issues/opened.json";
import {
  fromBot,
  fromOwner,
  MALFORMED_COMMENT_FIELDS,
  MALFORMED_ISSUE_FIELDS,
  MALFORMED_SENDERS,
  ORGANIZATION_OWNER,
  OWNER,
} from "../../test/issue";
import type { MalformedField } from "../../test/issue";
import { ABSENT, variant } from "../../test/pull-request";
import { MESSAGE_TEXTS } from "../i18n/messages";
import { authorContext, bodyExcerpt, commentOf, EXCERPT_MAX_CHARACTERS, isForeignSender, issueOf } from "./issue";

const MEBIBYTE = 1_048_576;

/** `unit` repeated until the text is at least 1 MiB long. */
function mebibyteOf(unit: string): string {
  return unit.repeat(Math.ceil(MEBIBYTE / unit.length));
}

describe("isForeignSender", () => {
  it("isForeignSender is true for another account than the User owner", () => {
    const foreign = isForeignSender(issuesOpened, OWNER);

    expect(foreign, "foreign sender").toBe(true);
  });

  it("isForeignSender is false for the User owner's id and for a Bot sender", () => {
    const own = isForeignSender(fromOwner(issuesOpened), OWNER);
    const bot = isForeignSender(fromBot(issuesOpened), OWNER);

    expect(own, "owner's own delivery").toBe(false);
    expect(bot, "bot's delivery").toBe(false);
  });

  it("isForeignSender is false for a renamed login with the User owner's id", () => {
    const payload = variant(fromOwner(issuesOpened), ["sender", "login"], "renamed-owner");

    const foreign = isForeignSender(payload, OWNER);

    expect(foreign, "foreign sender").toBe(false);
  });

  it("isForeignSender is false for a Bot sender without an owner", () => {
    const foreign = isForeignSender(fromBot(issuesOpened), undefined);

    expect(foreign, "foreign sender").toBe(false);
  });

  it("isForeignSender is true for a User whose login ends in [bot]", () => {
    const payload = variant(issuesOpened, ["sender", "login"], "lookalike[bot]");

    const foreign = isForeignSender(payload, OWNER);

    expect(foreign, "foreign sender").toBe(true);
  });

  it.each<{ case: string; owner: typeof OWNER | undefined }>([
    { case: "an organization owner's id", owner: ORGANIZATION_OWNER },
    { case: "no owner", owner: undefined },
  ])("isForeignSender is true for the owner's own delivery with $case", ({ owner }) => {
    const foreign = isForeignSender(fromOwner(issuesOpened), owner);

    expect(foreign, "foreign sender").toBe(true);
  });

  it.each<MalformedField>(MALFORMED_SENDERS)("isForeignSender is false when $field is $label", ({ path, value }) => {
    const payload = variant(issuesOpened, path, value);

    const foreign = isForeignSender(payload, OWNER);

    expect(foreign, "foreign sender").toBe(false);
  });
});

describe("issueOf", () => {
  it("issueOf returns the fields of the issue of the opened fixture", () => {
    const issue = issueOf(issuesOpened);

    expect(issue, "issue").toEqual({
      repository: "example-owner/example-repo",
      number: 7,
      title: "Example issue from another user",
      url: "https://github.com/example-owner/example-repo/issues/7",
      author: "example-other-user",
      body: "An example issue body written by another user.",
      target: { kind: "issue" },
    });
  });

  it("issueOf returns a pull request with draft false for the comment on a pull request", () => {
    const issue = issueOf(pullRequestComment);

    expect(issue, "issue").toEqual({
      repository: "example-owner/example-repo",
      number: 12,
      title: "Example pull request from another user",
      url: "https://github.com/example-owner/example-repo/pull/12",
      author: "example-other-user",
      body: "An example pull request description written by another user.",
      target: { kind: "pull-request", draft: false },
    });
  });

  it("issueOf returns a pull request with draft true for the comment on a draft pull request", () => {
    const issue = issueOf(draftPullRequestComment);

    expect(issue?.target, "target").toEqual({ kind: "pull-request", draft: true });
  });

  it("issueOf returns a pull request with an undefined draft when issue.draft is absent", () => {
    const issue = issueOf(variant(pullRequestComment, ["issue", "draft"], ABSENT));

    expect(issue?.target, "target").toEqual({ kind: "pull-request", draft: undefined });
  });

  it("issueOf returns an issue for a comment on an issue", () => {
    const issue = issueOf(issueCommentCreated);

    expect(issue?.target, "target").toEqual({ kind: "issue" });
    expect(issue?.number, "number").toBe(7);
  });

  it.each([
    { case: "null", body: null },
    { case: "missing", body: ABSENT },
  ])("issueOf reads a body that is $case as undefined", ({ body }) => {
    const issue = issueOf(variant(issuesOpened, ["issue", "body"], body));

    expect(issue, "issue is returned").toBeDefined();
    expect(issue?.body, "body").toBeUndefined();
  });

  it.each([1, 9_007_199_254_740_991])("issueOf accepts the number %s", (number) => {
    const issue = issueOf(variant(issuesOpened, ["issue", "number"], number));

    expect(issue?.number, "number").toBe(number);
  });

  it.each<MalformedField>(MALFORMED_ISSUE_FIELDS)(
    "issueOf returns undefined when $field is $label",
    ({ path, value }) => {
      const issue = issueOf(variant(issuesOpened, path, value));

      expect(issue, "issue").toBeUndefined();
    },
  );

  it.each<{ case: string; value: unknown }>([
    { case: "a string", value: "true" },
    { case: "a number", value: 1 },
    { case: "null", value: null },
  ])("issueOf returns undefined for a pull request whose issue.draft is $case", ({ value }) => {
    const issue = issueOf(variant(pullRequestComment, ["issue", "draft"], value));

    expect(issue, "issue").toBeUndefined();
  });

  it("issueOf returns undefined for a payload of another event", () => {
    const issue = issueOf({ action: "opened", repository: issuesOpened.repository });

    expect(issue, "issue").toBeUndefined();
  });
});

describe("commentOf", () => {
  it("commentOf returns the fields of the comment of the fixture", () => {
    const comment = commentOf(issueCommentCreated);

    expect(comment, "comment").toEqual({
      url: "https://github.com/example-owner/example-repo/issues/7#issuecomment-5000001",
      author: "example-other-user",
      body: "An example comment written by another user.",
    });
  });

  it.each([
    { case: "null", body: null },
    { case: "missing", body: ABSENT },
  ])("commentOf reads a body that is $case as undefined", ({ body }) => {
    const comment = commentOf(variant(issueCommentCreated, ["comment", "body"], body));

    expect(comment, "comment is returned").toBeDefined();
    expect(comment?.body, "body").toBeUndefined();
  });

  it.each<MalformedField>(MALFORMED_COMMENT_FIELDS)(
    "commentOf returns undefined when $field is $label",
    ({ path, value }) => {
      const comment = commentOf(variant(issueCommentCreated, path, value));

      expect(comment, "comment").toBeUndefined();
    },
  );
});

describe("bodyExcerpt", () => {
  it.each<{ case: string; body: string | undefined; expected: string }>([
    { case: "undefined", body: undefined, expected: "" },
    { case: "an empty body", body: "", expected: "" },
    { case: "a blank body", body: " \n\t\r\n ", expected: "" },
    { case: "a body of one HTML comment", body: "<!-- Describe the problem -->", expected: "" },
    { case: "a body of two HTML comments", body: "<!-- a --> <!-- b -->\n", expected: "" },
    { case: "a body of an unterminated HTML comment", body: "<!-- Describe the problem", expected: "" },
    { case: "plain text", body: "Steps: run it", expected: "Steps: run it" },
    { case: "an HTML comment between two words", body: "before <!-- hidden --> after", expected: "before after" },
    { case: "an HTML comment without spaces around it", body: "a<!-- hidden -->b", expected: "ab" },
    { case: "an HTML comment spanning lines", body: "a <!--\nhidden\nlines\n--> b", expected: "a b" },
    { case: "an HTML comment with an empty text", body: "<!---->x", expected: "x" },
    { case: "two HTML comments in a row", body: "<!-- a --><!-- b -->x", expected: "x" },
    { case: "an unterminated HTML comment after text", body: "keep <!-- hidden to the end", expected: "keep" },
    { case: "an unterminated comment after a closed one", body: "a <!-- x --> b <!-- y", expected: "a b" },
    { case: "a closer without an opener", body: "a --> b", expected: "a --> b" },
    {
      case: "a template with white-space runs",
      body: "## Context\n\nSeluna   sends\t…\r\n",
      expected: "## Context Seluna sends …",
    },
    { case: "leading and trailing white space", body: "\n  text  \n", expected: "text" },
    { case: "a no-break space run", body: "a  b", expected: "a b" },
    { case: "a line separator", body: "a b", expected: "a b" },
    {
      case: "other Markdown",
      body: "**bold** [link](https://example.com) `code`",
      expected: "**bold** [link](https://example.com) `code`",
    },
    { case: "HTML other than a comment", body: "<b>bold</b> &amp; more", expected: "<b>bold</b> &amp; more" },
    { case: "a lone surrogate", body: "a\uD800b", expected: "a\uD800b" },
  ])("bodyExcerpt removes HTML comments and collapses white space for $case", ({ body, expected }) => {
    const excerpt = bodyExcerpt(body);

    expect(excerpt, "excerpt").toBe(expected);
  });

  it("bodyExcerpt returns the first 257 code points of a plain text longer than that", () => {
    const body = "0123456789".repeat(40);

    const excerpt = bodyExcerpt(body);

    expect(EXCERPT_MAX_CHARACTERS, "limit").toBe(257);
    expect(excerpt, "excerpt").toBe(body.slice(0, 257));
  });

  it("bodyExcerpt counts code points, not UTF-16 units, at the limit", () => {
    const body = "\u{1F600}".repeat(300);

    const excerpt = bodyExcerpt(body);

    expect(Array.from(excerpt), "code points").toHaveLength(257);
    expect(excerpt, "excerpt").toBe("\u{1F600}".repeat(257));
  });

  it("bodyExcerpt returns exactly 257 code points for a body of exactly 257 and keeps all of them", () => {
    const body = "x".repeat(257);

    const excerpt = bodyExcerpt(body);

    expect(excerpt, "excerpt").toBe(body);
  });

  it.each<{ case: string; body: string; expected: string }>([
    { case: "plain text", body: mebibyteOf("ab"), expected: "ab".repeat(128) + "a" },
    { case: "one unterminated opener, then text", body: "<!--" + mebibyteOf("x"), expected: "" },
    { case: "text, then one unterminated opener and text", body: "head <!--" + mebibyteOf("x"), expected: "head" },
    { case: "repeated openers without a closer", body: mebibyteOf("<!--"), expected: "" },
    { case: "repeated opener-closer pairs", body: mebibyteOf("<!-- c -->"), expected: "" },
    { case: "repeated opener-closer pairs, then text", body: mebibyteOf("<!-- c -->") + "tail", expected: "tail" },
    { case: "text and a comment, repeated", body: mebibyteOf("a <!-- c -->"), expected: "a ".repeat(128) + "a" },
    { case: "alternating openers and white space", body: mebibyteOf("<!-- \n"), expected: "" },
    { case: "one long white-space run, then text", body: mebibyteOf(" ") + "tail", expected: "tail" },
    { case: "white space between every letter", body: mebibyteOf("a \n\t"), expected: "a ".repeat(128) + "a" },
  ])("bodyExcerpt returns at most 257 code points for a 1 MiB body of $case", ({ body, expected }) => {
    const excerpt = bodyExcerpt(body);

    expect(body.length, "input size is at least 1 MiB").toBeGreaterThanOrEqual(MEBIBYTE);
    expect(Array.from(excerpt).length, "code points of the excerpt").toBeLessThanOrEqual(257);
    expect(excerpt, "excerpt").toBe(expected);
  });
});

describe("authorContext", () => {
  it("authorContext joins the author and the excerpt with a middle dot in English", () => {
    const context = authorContext(MESSAGE_TEXTS.en, "alice", "Steps:\n\n run it ");

    expect(context, "context").toBe("by alice · Steps: run it");
  });

  it("authorContext joins the author and the excerpt in German", () => {
    const context = authorContext(MESSAGE_TEXTS.de, "alice", "Steps");

    expect(context, "context").toBe("von alice · Steps");
  });

  it.each<{ case: string; body: string | undefined }>([
    { case: "undefined", body: undefined },
    { case: "empty", body: "" },
    { case: "blank", body: "  \n " },
    { case: "a comment only", body: "<!-- template -->" },
  ])("authorContext is the author alone for a body that is $case", ({ body }) => {
    const context = authorContext(MESSAGE_TEXTS.en, "alice", body);

    expect(context, "context").toBe("by alice");
  });

  it("authorContext is at most the author, the separator and 257 code points for a 1 MiB body", () => {
    const context = authorContext(MESSAGE_TEXTS.en, "alice", mebibyteOf("word "));

    expect(Array.from(context).length, "code points").toBeLessThanOrEqual("by alice · ".length + 257);
  });
});
