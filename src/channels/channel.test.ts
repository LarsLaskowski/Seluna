import { describe, expect, it } from "vitest";
import { contentNotification } from "./channel";
import type { StoredNotification } from "../notification";

const NOTIFICATION: StoredNotification = { title: "T", repository: "o/r", number: 7, subject: "S", context: "C" };

describe("contentNotification", () => {
  it("contentNotification returns the notification of a new row as it is", () => {
    const notification = contentNotification({ kind: "notification", notification: NOTIFICATION });

    expect(notification, "notification").toEqual(NOTIFICATION);
  });

  it("contentNotification returns the recovered notification of an old row", () => {
    const notification = contentNotification({ kind: "legacy", text: "<b>T</b> · o/r #7\nS\nC" });

    expect(notification, "notification").toEqual(NOTIFICATION);
  });

  it("contentNotification decodes the entities of an old row once", () => {
    const notification = contentNotification({ kind: "legacy", text: "<b>A &amp; B</b> · o/r\n&lt;x&gt; &amp;lt;" });

    expect(notification, "notification").toEqual({
      title: "A & B",
      repository: "o/r",
      number: undefined,
      subject: "<x> &lt;",
      context: "",
    });
  });

  it.each([
    { case: "an empty text", text: "" },
    { case: "a text that is not Telegram HTML", text: "plain text" },
    { case: "a text with more than three lines", text: "<b>T</b> · o/r\n1\n2\n3" },
  ])("contentNotification returns undefined for an old row with $case", ({ text }) => {
    const notification = contentNotification({ kind: "legacy", text });

    expect(notification, "notification").toBeUndefined();
  });
});
