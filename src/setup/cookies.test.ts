import { describe, expect, it } from "vitest";
import { cookieValues, setupCookie } from "./cookies";
import { growthRatio, LINEAR_RATIO_LIMIT, RATIO_TEST_TIMEOUT_MS } from "../../test/timing";

describe("setupCookie", () => {
  it("setupCookie writes Path=/setup, HttpOnly, Secure and SameSite=Strict", () => {
    const cookie = setupCookie("seluna_csrf", "abc");

    expect(cookie, "Set-Cookie value").toBe("seluna_csrf=abc; Path=/setup; HttpOnly; Secure; SameSite=Strict");
  });

  it("setupCookie writes Max-Age before the attributes when given", () => {
    const cookie = setupCookie("seluna_session", "v1.1.x", 43_200);

    expect(cookie, "Set-Cookie value").toBe(
      "seluna_session=v1.1.x; Max-Age=43200; Path=/setup; HttpOnly; Secure; SameSite=Strict",
    );
  });
});

describe("cookieValues", () => {
  it("cookieValues returns every value of the name in header order", () => {
    const values = cookieValues("seluna_session=a; other=x; seluna_session=b; seluna_session=c", "seluna_session");

    expect(values, "values").toEqual(["a", "b", "c"]);
  });

  it.each([
    { name: "a null header", header: null, expected: [] },
    { name: "a header without that name", header: "other=x; another=y", expected: [] },
    { name: "another case of the name", header: "SELUNA_SESSION=x", expected: [] },
    { name: "spaces around pair and value", header: "  seluna_session = abc  ; other=x", expected: ["abc"] },
    { name: "a value containing =", header: "seluna_session=a=b=", expected: ["a=b="] },
    { name: "a quoted value (kept with its quotes)", header: 'seluna_session="abc"', expected: ['"abc"'] },
    { name: "an empty value", header: "seluna_session=", expected: [""] },
  ])("cookieValues returns $expected for $name", ({ header, expected }) => {
    const values = cookieValues(header, "seluna_session");

    expect(values, "values").toEqual(expected);
  });

  // The length n is divisible by 2, 3, 9 and 17 (the patterns below repeat a piece of that length).
  const BASE_LENGTH = 30_600;

  it.each([
    { name: "spaces", inputAt: (length: number) => " ".repeat(length) },
    { name: "semicolons", inputAt: (length: number) => ";".repeat(length) },
    { name: "a pair without =", inputAt: (length: number) => "x".repeat(length) },
    { name: "a value of =", inputAt: (length: number) => "seluna_session=" + "=".repeat(length) },
    { name: "many matching pairs", inputAt: (length: number) => "seluna_session=v;".repeat(length / 17) },
  ])(
    "cookieValues takes time linear in the header length for $name",
    ({ inputAt }) => {
      const ratio = growthRatio((header) => cookieValues(header, "seluna_session"), inputAt, BASE_LENGTH);

      expect(ratio, "duration at 10 n divided by duration at n").toBeLessThan(LINEAR_RATIO_LIMIT);
    },
    RATIO_TEST_TIMEOUT_MS,
  );
});
