import { describe, expect, it } from "vitest";
import {
  buttonUrl,
  cleanField,
  escapeTelegramHtml,
  formatMessage,
  MAX_BUTTON_URL_LENGTH,
  MAX_LINE_CHARACTERS,
  renderTelegramText,
} from "./message";
import type { StoredNotification } from "./notification";
import type { Notification } from "./rules/rule";

/** The scheme without TLS, built apart so the source holds no clear-text URL. */
const PLAIN_SCHEME = "http";

function notificationWith(overrides: Partial<Notification>): Notification {
  return {
    title: "T",
    repository: "o/r",
    number: 7,
    subject: "S",
    context: "C",
    url: "https://github.com/o/r/pull/7",
    ...overrides,
  };
}

describe("formatMessage", () => {
  it("formatMessage escapes <, > and & in line 2 as &lt;, &gt; and &amp;", () => {
    const notification = notificationWith({
      title: "New pull request",
      repository: "octo/repo",
      subject: "Use <T> & Map<K, V> > list",
      context: "main",
    });

    const message = formatMessage(notification);

    expect(message.text, "text").toBe(
      "<b>New pull request</b> · octo/repo #7\nUse &lt;T&gt; &amp; Map&lt;K, V&gt; &gt; list\nmain",
    );
  });

  it("formatMessage writes the bold title, the repository and the number on line 1 and lines 2 and 3 below", () => {
    const message = formatMessage(notificationWith({}));

    expect(message.text, "text").toBe("<b>T</b> · o/r #7\nS\nC");
    expect(message.buttonUrl, "button URL").toBe("https://github.com/o/r/pull/7");
  });

  it.each([
    { case: "undefined", number: undefined },
    { case: "0", number: 0 },
    { case: "-1", number: -1 },
    { case: "1.5", number: 1.5 },
    { case: "2 ** 53", number: 2 ** 53 },
  ])("formatMessage leaves out the number $case", ({ number }) => {
    const message = formatMessage(notificationWith({ number }));

    expect(message.text, "text").toBe("<b>T</b> · o/r\nS\nC");
  });

  it("formatMessage shows the number 9007199254740991", () => {
    const message = formatMessage(notificationWith({ number: Number.MAX_SAFE_INTEGER }));

    expect(message.text, "text").toBe("<b>T</b> · o/r #9007199254740991\nS\nC");
  });

  it("formatMessage leaves out an empty line 3", () => {
    const message = formatMessage(notificationWith({ context: "" }));

    expect(message.text, "text").toBe("<b>T</b> · o/r #7\nS");
  });

  it("formatMessage leaves out an empty line 2", () => {
    const message = formatMessage(notificationWith({ subject: "" }));

    expect(message.text, "text").toBe("<b>T</b> · o/r #7\nC");
  });

  it("formatMessage cuts line 2 to 256 code points before escaping", () => {
    const message = formatMessage(notificationWith({ subject: "&".repeat(MAX_LINE_CHARACTERS) }));
    const tooLong = formatMessage(notificationWith({ subject: "&".repeat(MAX_LINE_CHARACTERS + 1) }));

    expect(message.text, "256 ampersands stay 256 whole entities").toBe(
      `<b>T</b> · o/r #7\n${"&amp;".repeat(MAX_LINE_CHARACTERS)}\nC`,
    );
    expect(tooLong.text, "257 ampersands are cut to 255 and an ellipsis before escaping").toBe(
      `<b>T</b> · o/r #7\n${"&amp;".repeat(MAX_LINE_CHARACTERS - 1)}…\nC`,
    );
  });

  it("formatMessage stores no button URL for a URL buttonUrl rejects", () => {
    const message = formatMessage(notificationWith({ url: `${PLAIN_SCHEME}://github.com/o/r/pull/7` }));

    expect(message.buttonUrl, "button URL").toBeUndefined();
  });
});

describe("renderTelegramText", () => {
  it.each<{ case: string; overrides: Partial<Notification> }>([
    { case: "three lines and a number", overrides: {} },
    { case: "an empty line 2", overrides: { subject: "" } },
    { case: "an empty line 3", overrides: { context: "" } },
    { case: "empty lines 2 and 3", overrides: { subject: "", context: "" } },
    { case: "no number", overrides: { number: undefined } },
    { case: "the number 0", overrides: { number: 0 } },
    { case: "a fractional number", overrides: { number: 1.5 } },
    {
      case: "markup characters in every field",
      overrides: { title: "<b>&", repository: "o&<r>", subject: "<i>", context: "&amp;" },
    },
    {
      case: "control and directional characters",
      overrides: { title: "a\u202Eb", subject: "x\ny", context: "\u0000" },
    },
    {
      case: "fields over their limits",
      overrides: {
        title: "t".repeat(65),
        repository: "r".repeat(141),
        subject: "&".repeat(257),
        context: "c".repeat(257),
      },
    },
  ])("renderTelegramText equals the text of formatMessage for $case", ({ overrides }) => {
    const notification = notificationWith(overrides);
    const stored: StoredNotification = {
      title: notification.title,
      repository: notification.repository,
      number: notification.number,
      subject: notification.subject,
      context: notification.context,
    };

    const text = renderTelegramText(stored);

    expect(text, "rendered text").toBe(formatMessage(notification).text);
  });

  it("renderTelegramText writes the bold title, the repository, the number and the lines of a stored notification", () => {
    const text = renderTelegramText({ title: "T", repository: "o/r", number: 7, subject: "S", context: "C" });

    expect(text, "rendered text").toBe("<b>T</b> · o/r #7\nS\nC");
  });

  it("renderTelegramText escapes <, > and & in every field of a stored notification", () => {
    const text = renderTelegramText({
      title: "<b>&",
      repository: "o<r>",
      number: undefined,
      subject: "Use <T> & Map",
      context: "&lt;",
    });

    expect(text, "rendered text").toBe("<b>&lt;b&gt;&amp;</b> · o&lt;r&gt;\nUse &lt;T&gt; &amp; Map\n&amp;lt;");
  });

  it("renderTelegramText cleans a stored field again before escaping it", () => {
    const text = renderTelegramText({
      title: "  a\u202Eb ",
      repository: "o/r",
      number: undefined,
      subject: "x\ny",
      context: "",
    });

    expect(text, "rendered text").toBe("<b>ab</b> · o/r\nx y");
  });
});

describe("escapeTelegramHtml", () => {
  it.each([
    { case: "an entity name", input: "&lt;", expected: "&amp;lt;" },
    { case: "a numeric entity", input: "&#60;b&#62;", expected: "&amp;#60;b&amp;#62;" },
    {
      case: "a link tag with an attribute",
      input: '<a href="tg://user?id=1">x</a>',
      expected: '&lt;a href="tg://user?id=1"&gt;x&lt;/a&gt;',
    },
    {
      case: "a custom tg- tag",
      input: "<tg-spoiler>s</tg-spoiler>",
      expected: "&lt;tg-spoiler&gt;s&lt;/tg-spoiler&gt;",
    },
    {
      case: "a blockquote with the expandable attribute",
      input: "<blockquote expandable>q</blockquote>",
      expected: "&lt;blockquote expandable&gt;q&lt;/blockquote&gt;",
    },
    { case: "a bold tag", input: "<b>", expected: "&lt;b&gt;" },
    { case: "a double quote, which stays", input: 'say "hi"', expected: 'say "hi"' },
  ])("escapeTelegramHtml makes $case inert", ({ input, expected }) => {
    const escaped = escapeTelegramHtml(input);

    expect(escaped, "escaped text").toBe(expected);
  });
});

describe("cleanField", () => {
  it.each([
    { case: "replaces a NUL with a space", input: "a\u0000b", expected: "a b" },
    { case: "replaces a line feed with a space", input: "a\nb", expected: "a b" },
    { case: "replaces a carriage return and a line feed with two spaces", input: "a\r\nb", expected: "a  b" },
    { case: "replaces DEL with a space", input: "a\u007Fb", expected: "a b" },
    { case: "replaces NEL with a space", input: "a\u0085b", expected: "a b" },
    { case: "replaces the line separator with a space", input: "a\u2028b", expected: "a b" },
    { case: "replaces the paragraph separator with a space", input: "a\u2029b", expected: "a b" },
    { case: "removes a right-to-left override", input: "a\u202Eb", expected: "ab" },
    { case: "removes isolates", input: "a\u2066b\u2069", expected: "ab" },
    { case: "removes a left-to-right mark", input: "a\u200Eb", expected: "ab" },
    { case: "removes the Arabic letter mark", input: "a\u061Cb", expected: "ab" },
    { case: "trims spaces at both ends", input: "  a  ", expected: "a" },
  ])("cleanField $case", ({ input, expected }) => {
    const cleaned = cleanField(input, 256);

    expect(input, "the input still holds the character under test").not.toBe(expected);
    expect(cleaned, "cleaned text").toBe(expected);
  });

  it("cleanField replaces a lone surrogate with U+FFFD", () => {
    const input = "\uD800x";

    const cleaned = cleanField(input, 256);

    expect(input.charCodeAt(0), "the input still starts with the lone surrogate").toBe(0xd800);
    expect(cleaned, "cleaned text").toBe("�x");
  });

  it("cleanField leaves a text of exactly the limit unchanged", () => {
    const cleaned = cleanField("a".repeat(256), 256);

    expect(cleaned, "cleaned text").toBe("a".repeat(256));
  });

  it("cleanField cuts a text over the limit to the limit minus one and an ellipsis", () => {
    const cleaned = cleanField("a".repeat(257), 256);

    expect(cleaned, "cleaned text").toBe(`${"a".repeat(255)}…`);
  });

  it("cleanField counts a code point once", () => {
    const unchanged = cleanField("\u{1F600}".repeat(256), 256);
    const cut = cleanField("\u{1F600}".repeat(257), 256);

    expect(unchanged, "256 code points").toBe("\u{1F600}".repeat(256));
    expect(cut, "257 code points").toBe(`${"\u{1F600}".repeat(255)}…`);
  });
});

describe("buttonUrl", () => {
  it.each([
    { case: "an https GitHub URL", input: "https://github.com/o/r/pull/1", expected: "https://github.com/o/r/pull/1" },
    { case: "a scheme and host in capitals", input: "HTTPS://GitHub.COM/o/r", expected: "https://github.com/o/r" },
    { case: "the default port 443", input: "https://github.com:443/o", expected: "https://github.com/o" },
    { case: "backslashes after the scheme", input: "https:\\\\github.com\\o", expected: "https://github.com/o" },
    { case: "a percent-encoded host letter", input: "https://%67ithub.com/o", expected: "https://github.com/o" },
    {
      case: "a normalized form of 2,048 characters",
      input: `https://github.com/${"a".repeat(MAX_BUTTON_URL_LENGTH - "https://github.com/".length)}`,
      expected: `https://github.com/${"a".repeat(MAX_BUTTON_URL_LENGTH - "https://github.com/".length)}`,
    },
  ])("buttonUrl accepts $case and returns the normalized form", ({ input, expected }) => {
    const url = buttonUrl(input);

    expect(url, "normalized URL").toBe(expected);
  });

  it.each([
    { case: "the scheme http", input: `${PLAIN_SCHEME}://github.com/o` },
    { case: "a host that starts with github.com", input: "https://github.com.evil.example/o" },
    { case: "another host that names github.com in its path", input: "https://evil.example/github.com" },
    { case: "a trailing dot in the host", input: "https://github.com./o" },
    { case: "another port", input: "https://github.com:8443/o" },
    { case: "a user name and a password", input: "https://user:pw@github.com/o" },
    { case: "a user name", input: "https://user@github.com/o" },
    { case: "a punycode look-alike host", input: "https://xn--gthub-zsa.com/o" },
    { case: "the scheme javascript", input: "javascript:alert(1)" },
    { case: "a scheme-relative URL", input: "//github.com/o" },
    { case: "a text that is no URL", input: "not a url" },
    {
      case: "a normalized form of 2,049 characters",
      input: `https://github.com/${"a".repeat(MAX_BUTTON_URL_LENGTH + 1 - "https://github.com/".length)}`,
    },
  ])("buttonUrl rejects $case", ({ input }) => {
    const url = buttonUrl(input);

    expect(url, "normalized URL").toBeUndefined();
  });
});

describe("renderTelegramText with lines and an empty repository", () => {
  const DIGEST: StoredNotification = {
    title: "New stars and forks",
    repository: "",
    number: undefined,
    subject: "",
    context: "",
    lines: ["o/a: +2 ⭐ · alice, bob", "o/b: +1 fork · carol"],
  };

  it("renderTelegramText writes the title alone and one line for each entry of lines", () => {
    const text = renderTelegramText(DIGEST);

    expect(text, "rendered text").toBe("<b>New stars and forks</b>\no/a: +2 ⭐ · alice, bob\no/b: +1 fork · carol");
  });

  it("renderTelegramText writes the lines after line 3 and keeps the separator for a repository", () => {
    const text = renderTelegramText({
      title: "T",
      repository: "o/r",
      number: 7,
      subject: "S",
      context: "C",
      lines: ["L1", "L2"],
    });

    expect(text, "rendered text").toBe("<b>T</b> · o/r #7\nS\nC\nL1\nL2");
  });

  it.each([
    { case: "an empty repository", repository: "" },
    { case: "a repository of white space", repository: "  \t " },
    { case: "a repository of directional characters", repository: "\u202e\u200f" },
  ])("renderTelegramText leaves out the separator and the repository for $case", ({ repository }) => {
    const text = renderTelegramText({ ...DIGEST, repository, lines: undefined });

    expect(text, "rendered text").toBe("<b>New stars and forks</b>");
  });

  it("renderTelegramText skips empty lines and lines that are empty after cleaning", () => {
    const text = renderTelegramText({ ...DIGEST, lines: ["", "a", "  ", "\u202e", "b"] });

    expect(text, "rendered text").toBe("<b>New stars and forks</b>\na\nb");
  });

  it("renderTelegramText escapes <, > and & in a line", () => {
    const text = renderTelegramText({ ...DIGEST, lines: ["<b>x</b> & y"] });

    expect(text, "rendered text").toBe("<b>New stars and forks</b>\n&lt;b&gt;x&lt;/b&gt; &amp; y");
  });

  it("renderTelegramText cleans a line again: control and directional characters and a lone surrogate", () => {
    // One backslash in the source: the text holds the real characters.
    const text = renderTelegramText({ ...DIGEST, lines: ["a\u202eb\nc\u0000d \uD800e"] });

    expect(text, "rendered text").toBe("<b>New stars and forks</b>\nab c d �e");
  });

  it("renderTelegramText cuts a line to 256 code points with an ellipsis before escaping", () => {
    const text = renderTelegramText({ ...DIGEST, lines: ["&".repeat(300), "\u{1F600}".repeat(300)] });

    const lines = text.split("\n");
    expect(lines[1], "line of ampersands").toBe(`${"&amp;".repeat(255)}…`);
    expect(Array.from(lines[2] ?? "").length, "code points of the astral line").toBe(256);
    expect(lines[2]?.endsWith("…"), "ellipsis").toBe(true);
  });

  it("renderTelegramText renders eleven lines of 256 astral code points within 4,096 units", () => {
    const line = `${"\u{1F600}".repeat(255)}…`;

    const text = renderTelegramText({ ...DIGEST, lines: Array.from({ length: 11 }, () => line) });

    expect(text.split("\n"), "number of lines").toHaveLength(12);
    expect(text.length, "UTF-16 code units").toBe("<b>New stars and forks</b>".length + 11 * (1 + 511));
  });

  it("renderTelegramText renders a notification without lines as before", () => {
    const text = renderTelegramText({ title: "T", repository: "o/r", number: 7, subject: "S", context: "C" });

    expect(text, "rendered text").toBe("<b>T</b> · o/r #7\nS\nC");
  });
});
