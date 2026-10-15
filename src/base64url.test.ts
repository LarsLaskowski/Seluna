import { describe, expect, it } from "vitest";
import { fromBase64Url, toBase64Url } from "./base64url";

describe("toBase64Url", () => {
  it.each([
    { name: "no bytes", bytes: [], expected: "" },
    { name: "one byte", bytes: [0xff], expected: "_w" },
    { name: "two bytes", bytes: [0xff, 0xff], expected: "__8" },
    { name: "three bytes with + and / in standard base64", bytes: [0xfb, 0xff, 0xfe], expected: "-__-" },
    { name: "a zero byte", bytes: [0], expected: "AA" },
  ])("toBase64Url writes base64url without padding for $name", ({ bytes, expected }) => {
    const text = toBase64Url(new Uint8Array(bytes));

    expect(text, "text").toBe(expected);
  });
});

describe("fromBase64Url", () => {
  it.each([
    { text: "", expected: [] },
    { text: "AA", expected: [0] },
    { text: "AAA", expected: [0, 0] },
    { text: "AQ", expected: [1] },
    { text: "_w", expected: [0xff] },
    { text: "__8", expected: [0xff, 0xff] },
    { text: "-__-", expected: [0xfb, 0xff, 0xfe] },
  ])("fromBase64Url returns the bytes of base64url text $text", ({ text, expected }) => {
    const bytes = fromBase64Url(text);

    expect(bytes, "bytes").toEqual(new Uint8Array(expected));
  });

  it.each([
    { name: "padding", text: "AA==" },
    { name: "a plus sign", text: "AA+A" },
    { name: "a slash", text: "AA/A" },
    { name: "a space", text: "AA A" },
    { name: "a newline", text: "AAAA\n" },
    { name: "a length of 4n+1", text: "AAAAA" },
    { name: "a non-ASCII character", text: "AAÄA" },
    { name: "non-zero unused bits in the last of two characters", text: "AB" },
    { name: "non-zero unused bits in the last of three characters", text: "AAB" },
  ])("fromBase64Url returns undefined for $name", ({ text }) => {
    const bytes = fromBase64Url(text);

    expect(bytes, "bytes").toBeUndefined();
  });
});
