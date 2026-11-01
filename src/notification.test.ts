import { describe, expect, it } from "vitest";
import {
  decodeStoredNotification,
  encodeStoredNotification,
  legacyNotificationOf,
  MAX_EXTRA_LINES,
  storedNotificationOf,
} from "./notification";
import type { StoredNotification } from "./notification";
import type { Notification } from "./rules/rule";

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

function storedWith(overrides: Partial<StoredNotification>): StoredNotification {
  return { title: "T", repository: "o/r", number: 7, subject: "S", context: "C", ...overrides };
}

describe("storedNotificationOf", () => {
  it("storedNotificationOf keeps the fields of a clean notification and leaves out the URL", () => {
    const stored = storedNotificationOf(notificationWith({}));

    expect(stored, "stored notification").toEqual({
      title: "T",
      repository: "o/r",
      number: 7,
      subject: "S",
      context: "C",
    });
    expect("url" in stored, "the stored form has no URL").toBe(false);
  });

  it("storedNotificationOf cleans every field and does not escape it", () => {
    const stored = storedNotificationOf(
      notificationWith({
        title: " a\u202Eb<c> ",
        repository: "o/\nr&",
        subject: "x\u0000y <i>",
        context: "\uD800z",
      }),
    );

    expect(stored, "stored notification").toEqual({
      title: "ab<c>",
      repository: "o/ r&",
      number: 7,
      subject: "x y <i>",
      context: "�z",
    });
  });

  it("storedNotificationOf cuts the fields to 64, 140, 256 and 256 code points with an ellipsis", () => {
    const stored = storedNotificationOf(
      notificationWith({
        title: "t".repeat(65),
        repository: "r".repeat(141),
        subject: "s".repeat(257),
        context: "c".repeat(257),
      }),
    );

    expect(stored.title, "title").toBe(`${"t".repeat(63)}…`);
    expect(stored.repository, "repository").toBe(`${"r".repeat(139)}…`);
    expect(stored.subject, "line 2").toBe(`${"s".repeat(255)}…`);
    expect(stored.context, "line 3").toBe(`${"c".repeat(255)}…`);
  });

  it("storedNotificationOf leaves fields of exactly the limits unchanged", () => {
    const stored = storedNotificationOf(
      notificationWith({
        title: "t".repeat(64),
        repository: "r".repeat(140),
        subject: "s".repeat(256),
        context: "c".repeat(256),
      }),
    );

    expect(stored.title, "title").toBe("t".repeat(64));
    expect(stored.repository, "repository").toBe("r".repeat(140));
    expect(stored.subject, "line 2").toBe("s".repeat(256));
    expect(stored.context, "line 3").toBe("c".repeat(256));
  });

  it.each([
    { case: "undefined", number: undefined, expected: undefined },
    { case: "0", number: 0, expected: undefined },
    { case: "-1", number: -1, expected: undefined },
    { case: "1.5", number: 1.5, expected: undefined },
    { case: "NaN", number: Number.NaN, expected: undefined },
    { case: "2 ** 53", number: 2 ** 53, expected: undefined },
    { case: "1", number: 1, expected: 1 },
    { case: "9007199254740991", number: Number.MAX_SAFE_INTEGER, expected: Number.MAX_SAFE_INTEGER },
  ])("storedNotificationOf keeps only a valid number: $case", ({ number, expected }) => {
    const stored = storedNotificationOf(notificationWith({ number }));

    expect(stored.number, "number").toBe(expected);
  });
});

describe("encodeStoredNotification and decodeStoredNotification", () => {
  it("encodeStoredNotification writes a JSON object with the keys in order and null for a missing number", () => {
    const withNumber = encodeStoredNotification(storedWith({}));
    const withoutNumber = encodeStoredNotification(storedWith({ number: undefined, context: "" }));

    expect(withNumber, "with a number").toBe('{"title":"T","repository":"o/r","number":7,"subject":"S","context":"C"}');
    expect(withoutNumber, "without a number").toBe(
      '{"title":"T","repository":"o/r","number":null,"subject":"S","context":""}',
    );
  });

  it("encodeStoredNotification starts with { and holds no Telegram markup for a title with <, > and &", () => {
    const text = encodeStoredNotification(storedWith({ title: "<b>&</b>" }));

    expect(text.startsWith("{"), "starts with a brace").toBe(true);
    expect(text, "the title as it is, not escaped").toContain('"title":"<b>&</b>"');
  });

  it.each([
    { case: "a number", notification: storedWith({}) },
    { case: "no number", notification: storedWith({ number: undefined }) },
    { case: "empty lines", notification: storedWith({ subject: "", context: "" }) },
    {
      case: "markup characters, quotes, a backslash and an astral character",
      notification: storedWith({ title: '<b>"x"</b> & \\ \u{1F600}', subject: "a b" }),
    },
  ])("decodeStoredNotification returns what encodeStoredNotification wrote for $case", ({ notification }) => {
    const decoded = decodeStoredNotification(encodeStoredNotification(notification));

    expect(decoded, "round trip").toEqual(notification);
  });

  it.each([
    { case: "malformed JSON", json: "{not json" },
    { case: "an empty text", json: "" },
    { case: "a JSON string", json: '"title"' },
    { case: "a JSON number", json: "7" },
    { case: "null", json: "null" },
    { case: "an array", json: '["T","o/r",7,"S","C"]' },
    { case: "a missing title", json: '{"repository":"o/r","number":7,"subject":"S","context":"C"}' },
    { case: "a missing repository", json: '{"title":"T","number":7,"subject":"S","context":"C"}' },
    { case: "a missing subject", json: '{"title":"T","repository":"o/r","number":7,"context":"C"}' },
    { case: "a missing context", json: '{"title":"T","repository":"o/r","number":7,"subject":"S"}' },
    { case: "a title that is a number", json: '{"title":1,"repository":"o/r","number":7,"subject":"S","context":"C"}' },
    {
      case: "a subject that is null",
      json: '{"title":"T","repository":"o/r","number":7,"subject":null,"context":"C"}',
    },
    { case: "a number as a string", json: '{"title":"T","repository":"o/r","number":"7","subject":"S","context":"C"}' },
    { case: "the number 0", json: '{"title":"T","repository":"o/r","number":0,"subject":"S","context":"C"}' },
    { case: "a negative number", json: '{"title":"T","repository":"o/r","number":-3,"subject":"S","context":"C"}' },
    { case: "a fractional number", json: '{"title":"T","repository":"o/r","number":1.5,"subject":"S","context":"C"}' },
    {
      case: "a number above the safe integers",
      json: '{"title":"T","repository":"o/r","number":9007199254740992,"subject":"S","context":"C"}',
    },
  ])("decodeStoredNotification returns undefined for $case", ({ json }) => {
    const decoded = decodeStoredNotification(json);

    expect(decoded, "decoded notification").toBeUndefined();
  });
});

describe("legacyNotificationOf", () => {
  it("legacyNotificationOf recovers title, repository, number and lines of a three-line text", () => {
    const stored = legacyNotificationOf("<b>New pull request</b> · octo/repo #143\nFix the bug\nby octo · main");

    expect(stored, "recovered notification").toEqual({
      title: "New pull request",
      repository: "octo/repo",
      number: 143,
      subject: "Fix the bug",
      context: "by octo · main",
    });
  });

  it("legacyNotificationOf returns the first further line as line 2 when only one further line is there", () => {
    const stored = legacyNotificationOf("<b>T</b> · o/r #7\nC");

    expect(stored, "recovered notification").toEqual(storedWith({ subject: "C", context: "" }));
  });

  it("legacyNotificationOf returns empty lines 2 and 3 for a text of one line", () => {
    const stored = legacyNotificationOf("<b>T</b> · o/r #7");

    expect(stored, "recovered notification").toEqual(storedWith({ subject: "", context: "" }));
  });

  it("legacyNotificationOf recovers a text without a number", () => {
    const stored = legacyNotificationOf("<b>Alert</b> · o/r\nS\nC");

    expect(stored, "recovered notification").toEqual(storedWith({ title: "Alert", number: undefined }));
  });

  it("legacyNotificationOf recovers the release notice with its one further line", () => {
    const stored = legacyNotificationOf(
      "<b>New Seluna release</b> · LarsLaskowski/Seluna\nVersion 0.5.0 is available; this instance runs 0.4.0.",
    );

    expect(stored, "recovered notification").toEqual({
      title: "New Seluna release",
      repository: "LarsLaskowski/Seluna",
      number: undefined,
      subject: "Version 0.5.0 is available; this instance runs 0.4.0.",
      context: "",
    });
  });

  it("legacyNotificationOf decodes &lt;, &gt; and &amp; in every field", () => {
    const stored = legacyNotificationOf("<b>a&lt;b&gt;&amp;c</b> · o&amp;/r #7\nx &lt;i&gt;\n&amp;y");

    expect(stored, "recovered notification").toEqual({
      title: "a<b>&c",
      repository: "o&/r",
      number: 7,
      subject: "x <i>",
      context: "&y",
    });
  });

  it("legacyNotificationOf decodes &amp;lt; once, to &lt;", () => {
    const stored = legacyNotificationOf("<b>&amp;lt;</b> · o/r\n&amp;gt; &amp;amp;");

    expect(stored?.title, "title").toBe("&lt;");
    expect(stored?.subject, "line 2").toBe("&gt; &amp;");
  });

  it("legacyNotificationOf decodes nothing but those three entities", () => {
    const stored = legacyNotificationOf("<b>&quot;&#39;&nbsp;</b> · o/r");

    expect(stored?.title, "title").toBe("&quot;&#39;&nbsp;");
  });

  it("legacyNotificationOf takes the first </b> · as the end of the title", () => {
    const stored = legacyNotificationOf("<b>A</b> · B</b> · C #5\nS");

    expect(stored, "recovered notification").toEqual(
      storedWith({ title: "A", repository: "B</b> · C", number: 5, subject: "S", context: "" }),
    );
  });

  it.each([
    { case: "0", suffix: " #0" },
    { case: "a number with a leading zero", suffix: " #07" },
    { case: "17 digits", suffix: " #12345678901234567" },
    { case: "a number above the safe integers", suffix: " #9007199254740992" },
    { case: "a text after the digits", suffix: " #7x" },
    { case: "no digits", suffix: " #" },
  ])("legacyNotificationOf keeps a trailing #-part with $case in the repository", ({ suffix }) => {
    const stored = legacyNotificationOf(`<b>T</b> · o/r${suffix}`);

    expect(stored?.repository, "repository").toBe(`o/r${suffix}`);
    expect(stored?.number, "number").toBeUndefined();
  });

  it("legacyNotificationOf reads the largest safe integer as the number", () => {
    const stored = legacyNotificationOf("<b>T</b> · o/r #9007199254740991");

    expect(stored?.repository, "repository").toBe("o/r");
    expect(stored?.number, "number").toBe(Number.MAX_SAFE_INTEGER);
  });

  it.each([
    { case: "an empty text", text: "" },
    { case: "text that is not Telegram HTML", text: "plain text" },
    { case: "a stored JSON text", text: '{"title":"T"}' },
    { case: "a text not starting with <b>", text: "x<b>T</b> · o/r" },
    { case: "a first line without </b> · ", text: "<b>T · o/r" },
    { case: "a first line with a bare </b>", text: "<b>T</b>o/r" },
    { case: "more than three lines", text: "<b>T</b> · o/r\n1\n2\n3" },
  ])("legacyNotificationOf returns undefined for $case", ({ text }) => {
    const stored = legacyNotificationOf(text);

    expect(stored, "recovered notification").toBeUndefined();
  });
});

const BASE_ROW = '"title":"T","repository":"o/r","number":7,"subject":"S","context":"C"';

describe("the lines of a stored notification", () => {
  it("MAX_EXTRA_LINES is 11", () => {
    expect(MAX_EXTRA_LINES, "limit").toBe(11);
  });

  it("encodeStoredNotification writes lines after context", () => {
    const text = encodeStoredNotification(storedWith({ lines: ["a", "b <c>"] }));

    expect(text, "encoded").toBe(`{${BASE_ROW},"lines":["a","b <c>"]}`);
  });

  it.each([
    { case: "no lines", notification: storedWith({}) },
    { case: "an empty list of lines", notification: storedWith({ lines: [] }) },
  ])("encodeStoredNotification leaves the key lines out for $case", ({ notification }) => {
    const text = encodeStoredNotification(notification);

    expect(text, "encoded").toBe(`{${BASE_ROW}}`);
  });

  it.each([
    { case: "one line", lines: ["a"] },
    { case: "three lines with markup, quotes and an astral character", lines: ['<b>"x"</b>', "a & b", "\u{1F600}"] },
    { case: "the most lines", lines: Array.from({ length: 11 }, (_unused, index) => `line ${String(index)}`) },
  ])("decodeStoredNotification returns what encodeStoredNotification wrote for $case", ({ lines }) => {
    const notification = storedWith({ number: undefined, repository: "", subject: "", context: "", lines });

    const decoded = decodeStoredNotification(encodeStoredNotification(notification));

    expect(decoded, "round trip").toEqual(notification);
  });

  it("decodeStoredNotification returns a row without lines as before, with no lines", () => {
    const decoded = decodeStoredNotification(`{${BASE_ROW}}`);

    expect(decoded, "decoded").toEqual(storedWith({}));
    expect(decoded?.lines, "lines").toBeUndefined();
  });

  it("decodeStoredNotification ignores an unknown key", () => {
    const decoded = decodeStoredNotification(`{${BASE_ROW},"future":["x"]}`);

    expect(decoded, "decoded").toEqual(storedWith({}));
  });

  it.each([
    { case: "twelve lines", lines: JSON.stringify(Array.from({ length: 12 }, () => "x")) },
    { case: "a number in the list", lines: '["a",1]' },
    { case: "null in the list", lines: '["a",null]' },
    { case: "a nested list", lines: '[["a"]]' },
    { case: "an object in the list", lines: '[{"a":"b"}]' },
    { case: "a string instead of a list", lines: '"a"' },
    { case: "an object instead of a list", lines: '{"0":"a"}' },
    { case: "a number instead of a list", lines: "3" },
    { case: "null instead of a list", lines: "null" },
    { case: "true instead of a list", lines: "true" },
  ])("decodeStoredNotification returns undefined for lines that are $case", ({ lines }) => {
    const decoded = decodeStoredNotification(`{${BASE_ROW},"lines":${lines}}`);

    expect(decoded, "decoded notification").toBeUndefined();
  });

  it("storedNotificationOf gives a notification no lines", () => {
    const stored = storedNotificationOf(notificationWith({}));

    expect("lines" in stored, "the stored form has no lines key").toBe(false);
  });
});
