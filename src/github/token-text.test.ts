import { describe, expect, it } from "vitest";
import { isInstallationTokenText } from "./token-text";
import { FIXTURE_TOKEN, STATELESS_TOKEN } from "../../test/github";

describe("isInstallationTokenText", () => {
  it("isInstallationTokenText accepts the stateless token", () => {
    const afterPrefix = STATELESS_TOKEN.slice("ghs_".length);

    const accepted = isInstallationTokenText(STATELESS_TOKEN);

    expect(STATELESS_TOKEN.length, "length of the stateless token").toBeGreaterThan(255);
    expect(STATELESS_TOKEN.startsWith("ghs_"), "prefix of the stateless token").toBe(true);
    expect(STATELESS_TOKEN.split(".").length - 1, "dots in the stateless token").toBe(2);
    expect(afterPrefix.includes("-"), "hyphen after the prefix").toBe(true);
    expect(afterPrefix.includes("_"), "underscore after the prefix").toBe(true);
    expect(accepted, "accepted").toBe(true);
  });

  it.each([
    { case: "the documented token", token: FIXTURE_TOKEN },
    { case: "one character", token: "a" },
    { case: "digits, letters and underscores", token: "A_9z" },
    { case: "255 characters", token: "a".repeat(255) },
    { case: "a hyphen", token: "a-b" },
    { case: "a dot", token: "a.b" },
  ])("isInstallationTokenText accepts $case", ({ token }) => {
    const accepted = isInstallationTokenText(token);

    expect(accepted, "accepted").toBe(true);
  });

  it("isInstallationTokenText accepts 4096 characters", () => {
    const token = "a".repeat(4096);

    const accepted = isInstallationTokenText(token);

    expect(accepted, "accepted").toBe(true);
  });

  it.each([
    { case: "an empty text", token: "" },
    { case: "4097 characters", token: "a".repeat(4097) },
    { case: "a space", token: "a b" },
    { case: "a plus sign", token: "a+b" },
    { case: "a slash", token: "a/b" },
    { case: "an equals sign", token: "a=b" },
    { case: "a colon", token: "a:b" },
    { case: "a non-ASCII letter", token: "ä" },
  ])("isInstallationTokenText rejects $case", ({ token }) => {
    const accepted = isInstallationTokenText(token);

    expect(accepted, "accepted").toBe(false);
  });

  it.each([
    { case: "a tab", token: "a\tb", codePoint: 0x09 },
    { case: "a line break in a header injection", token: "a\r\nX: y", codePoint: 0x0a },
    { case: "a trailing line feed", token: "a\n", codePoint: 0x0a },
    { case: "U+0000", token: "a\u0000b", codePoint: 0x00 },
    { case: "U+007F", token: "a\u007Fb", codePoint: 0x7f },
  ])("isInstallationTokenText rejects $case", ({ token, codePoint }) => {
    const accepted = isInstallationTokenText(token);

    expect(token.includes(String.fromCodePoint(codePoint)), "the input holds the control character").toBe(true);
    expect(accepted, "accepted").toBe(false);
  });
});
