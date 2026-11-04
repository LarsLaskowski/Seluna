import { describe, expect, it } from "vitest";
import { limitNotice } from "./limit-notice";
import type { BoundedEvent } from "./store/meta";

/** 12:34 UTC, inside the UTC hour 12:00 to 13:00. */
const NOON = new Date(Date.UTC(2026, 10, 4, 12, 34, 56));
const TITLE_EN = "Notifications left out";
const TITLE_DE = "Benachrichtigungen ausgelassen";
const CONTEXT_EN = "Further ones in that hour are not reported; GitHub still shows them.";
const CONTEXT_DE = "Weitere in dieser Stunde werden nicht gemeldet; GitHub zeigt sie weiterhin.";

describe("limitNotice", () => {
  it.each<{ event: BoundedEvent; kind: string }>([
    { event: "issues", kind: "Issues" },
    { event: "issue_comment", kind: "Comments" },
    { event: "star", kind: "Stars and unstars" },
    { event: "fork", kind: "Forks" },
    { event: "pull_request", kind: "Pull requests" },
    { event: "workflow_run", kind: "CI failures" },
  ])("limitNotice returns the English notice of $event for 12:00 to 13:00 UTC", ({ event, kind }) => {
    const notice = limitNotice(event, NOON, 20, "en");

    expect(notice, "notice").toEqual({
      title: TITLE_EN,
      repository: "",
      number: undefined,
      subject: `${kind}: more than 20 between 12:00 and 13:00 UTC`,
      context: CONTEXT_EN,
    });
  });

  it.each<{ event: BoundedEvent; kind: string }>([
    { event: "issues", kind: "Issues" },
    { event: "issue_comment", kind: "Kommentare" },
    { event: "star", kind: "Sterne und entfernte Sterne" },
    { event: "fork", kind: "Forks" },
    { event: "pull_request", kind: "Pull Requests" },
    { event: "workflow_run", kind: "CI-Fehlschläge" },
  ])("limitNotice returns the German notice of $event for 12:00 to 13:00 UTC", ({ event, kind }) => {
    const notice = limitNotice(event, NOON, 20, "de");

    expect(notice, "notice").toEqual({
      title: TITLE_DE,
      repository: "",
      number: undefined,
      subject: `${kind}: mehr als 20 zwischen 12:00 und 13:00 UTC`,
      context: CONTEXT_DE,
    });
  });

  it.each<{ language: "en" | "de"; subject: string }>([
    { language: "en", subject: "Issues: more than 20 between 23:00 and 00:00 UTC" },
    { language: "de", subject: "Issues: mehr als 20 zwischen 23:00 und 00:00 UTC" },
  ])("limitNotice writes 23:00 and 00:00 for the last UTC hour of a day in $language", ({ language, subject }) => {
    const lastHour = new Date(Date.UTC(2026, 10, 4, 23, 59, 59, 999));

    const notice = limitNotice("issues", lastHour, 20, language);

    expect(notice.subject, "subject").toBe(subject);
  });

  it("limitNotice pads the hours to two digits for 00:00 to 01:00 UTC", () => {
    const midnight = new Date(Date.UTC(2026, 10, 4, 0, 0, 0));

    const notice = limitNotice("fork", midnight, 20, "en");

    expect(notice.subject, "subject").toBe("Forks: more than 20 between 00:00 and 01:00 UTC");
  });

  it("limitNotice writes the limit it is given", () => {
    const notice = limitNotice("issues", NOON, 7, "en");

    expect(notice.subject, "subject").toBe("Issues: more than 7 between 12:00 and 13:00 UTC");
  });

  it("limitNotice leaves the repository, the number and the further lines empty", () => {
    const notice = limitNotice("star", NOON, 20, "en");

    expect(notice.repository, "repository").toBe("");
    expect(notice.number, "number").toBeUndefined();
    expect(notice.lines, "further lines").toBeUndefined();
  });
});
