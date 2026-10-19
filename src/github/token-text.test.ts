import { describe, expect, it } from "vitest";
import { isInstallationTokenText } from "./token-text";
import { FIXTURE_TOKEN } from "../../test/github";

describe("isInstallationTokenText", () => {
  it.each([
    { case: "the documented token", token: FIXTURE_TOKEN },
    { case: "one character", token: "a" },
    { case: "digits, letters and underscores", token: "A_9z" },
    { case: "255 characters", token: "a".repeat(255) },
  ])("isInstallationTokenText accepts $case", ({ token }) => {
    const accepted = isInstallationTokenText(token);

    expect(accepted, "accepted").toBe(true);
  });

  it.each([
    { case: "an empty text", token: "" },
    { case: "256 characters", token: "a".repeat(256) },
    { case: "a hyphen", token: "a-b" },
    { case: "a space", token: "a b" },
    { case: "a line break in a header injection", token: "a\r\nX: y" },
    { case: "a trailing line feed", token: "a\n" },
    { case: "a non-ASCII letter", token: "ä" },
    { case: "a dot", token: "a.b" },
  ])("isInstallationTokenText rejects $case", ({ token }) => {
    const accepted = isInstallationTokenText(token);

    expect(accepted, "accepted").toBe(false);
  });
});
