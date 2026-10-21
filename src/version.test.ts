import { describe, expect, it } from "vitest";
import { compareVersions, parseReleaseTag, parseVersion, versionText } from "./version";

describe("parseVersion", () => {
  it.each([
    { text: "0.4.0", expected: { major: 0, minor: 4, patch: 0 } },
    { text: "0.0.0", expected: { major: 0, minor: 0, patch: 0 } },
    { text: "10.20.30", expected: { major: 10, minor: 20, patch: 30 } },
    { text: "999999999.0.0", expected: { major: 999_999_999, minor: 0, patch: 0 } },
    { text: "0.999999999.999999999", expected: { major: 0, minor: 999_999_999, patch: 999_999_999 } },
  ])("parseVersion accepts $text", ({ text, expected }) => {
    expect(parseVersion(text), "version").toEqual(expected);
  });

  it.each([
    "01.0.0",
    "1.00.0",
    "1.0.00",
    "1.0",
    "1",
    ["1", "0", "0", "0"].join("."),
    "1.0.0-rc.1",
    "1.0.0+build",
    "v1.0.0",
    "1000000000.0.0",
    "1.1000000000.0",
    "1.0.1000000000",
    "",
    " 1.0.0",
    "1.0.0 ",
    "1.0.0\n",
    "1.0.0‮",
    "１.0.0",
    "1.0.a",
    "-1.0.0",
    "1..0",
    "garbage",
  ])("parseVersion rejects %j", (text) => {
    expect(parseVersion(text), "version").toBeUndefined();
  });
});

describe("parseReleaseTag", () => {
  it.each([
    { tag: "v0.5.0", expected: { major: 0, minor: 5, patch: 0 } },
    { tag: "v0.0.0", expected: { major: 0, minor: 0, patch: 0 } },
    { tag: "v999999999.0.0", expected: { major: 999_999_999, minor: 0, patch: 0 } },
    { tag: "v12.34.56", expected: { major: 12, minor: 34, patch: 56 } },
  ])("parseReleaseTag accepts $tag", ({ tag, expected }) => {
    expect(parseReleaseTag(tag), "version").toEqual(expected);
  });

  it.each([
    "v0.5",
    "v0.5.0.1",
    "v0.5.0-rc.1",
    "v0.5.0+build",
    "0.5.0",
    "V0.5.0",
    "v01.5.0",
    "v0.05.0",
    "v0.5.00",
    "v1000000000.0.0",
    " v0.5.0",
    "v0.5.0 ",
    "v 0.5.0",
    "v0.5.0\n",
    "\nv0.5.0",
    "v0.5.0‮",
    "v０.5.0",
    "v0.５.0",
    "v0.5.0<b>",
    "v0.5.0\u0000",
    "",
    "v",
  ])("parseReleaseTag rejects %j", (tag) => {
    expect(parseReleaseTag(tag), "version").toBeUndefined();
  });

  it("parseReleaseTag rejects a tag of 1 MiB", () => {
    const tag = `v0.5.0${"0".repeat(1_048_576)}`;

    expect(parseReleaseTag(tag), "version").toBeUndefined();
  });
});

describe("compareVersions", () => {
  it.each([
    { left: "0.10.0", right: "0.9.0" },
    { left: "1.0.0", right: "0.99.99" },
    { left: "0.5.1", right: "0.5.0" },
    { left: "2.0.0", right: "1.999.999" },
    { left: "999999999.0.0", right: "999999998.999999999.999999999" },
  ])("compareVersions reports $left as newer than $right", ({ left, right }) => {
    const result = compareVersions(requireVersion(left), requireVersion(right));

    expect(result, "result").toBeGreaterThan(0);
  });

  it.each([
    { left: "0.9.0", right: "0.10.0" },
    { left: "0.99.99", right: "1.0.0" },
    { left: "0.5.0", right: "0.5.1" },
  ])("compareVersions reports $left as older than $right", ({ left, right }) => {
    const result = compareVersions(requireVersion(left), requireVersion(right));

    expect(result, "result").toBeLessThan(0);
  });

  it.each(["0.0.0", "0.4.0", "1.0.0", "999999999.999999999.999999999"])(
    "compareVersions reports %s as equal to itself",
    (text) => {
      const result = compareVersions(requireVersion(text), requireVersion(text));

      expect(result, "result").toBe(0);
    },
  );
});

describe("versionText", () => {
  it.each(["0.4.0", "0.0.0", "10.20.30", "999999999.0.1"])(
    "versionText gives %s back for the parsed version",
    (text) => {
      const text2 = versionText(requireVersion(text));

      expect(text2, "text").toBe(text);
    },
  );

  it("versionText joins the three numbers of a version with dots", () => {
    const text = versionText({ major: 3, minor: 14, patch: 15 });

    expect(text, "text").toBe("3.14.15");
  });
});

function requireVersion(text: string): NonNullable<ReturnType<typeof parseVersion>> {
  const version = parseVersion(text);
  if (version === undefined) {
    throw new Error(`The test version ${text} does not parse`);
  }
  return version;
}
