import { describe, expect, it } from "vitest";
import { csrfTokenFor, isValidCsrfToken, newCsrfCookieValue } from "./csrf";
import { hmacBase64Url, signingKeyFor, withUnusedBitFlipped } from "../../test/keys";

const SECRET_A = "0123456789abcdef0123456789abcdef";
const SECRET_B = "fedcba9876543210fedcba9876543210";
const BASE64URL_43 = /^[A-Za-z0-9_-]{43}$/;

const csrfKey = (secret: string): Promise<CryptoKey> => signingKeyFor(secret, "setup-csrf");

/** A well-formed cookie value of 43 characters that is different for each `number`. */
function cookieValue(number: number): string {
  return String.fromCharCode(65 + number).repeat(43);
}

describe("newCsrfCookieValue", () => {
  it("newCsrfCookieValue returns 43 base64url characters", () => {
    const value = newCsrfCookieValue();

    expect(value, "value").toMatch(BASE64URL_43);
  });

  it("newCsrfCookieValue returns another value on every call", () => {
    const first = newCsrfCookieValue();
    const second = newCsrfCookieValue();

    expect(first, "first value").not.toBe(second);
  });
});

describe("csrfTokenFor", () => {
  it("csrfTokenFor returns 43 base64url characters", async () => {
    const key = await csrfKey(SECRET_A);

    const token = await csrfTokenFor(key, cookieValue(0));

    expect(token, "token").toMatch(BASE64URL_43);
    expect(token, "token").toBe(await hmacBase64Url(key, cookieValue(0)));
  });
});

describe("isValidCsrfToken", () => {
  it("isValidCsrfToken accepts the token of the cookie value", async () => {
    const key = await csrfKey(SECRET_A);
    const token = await csrfTokenFor(key, cookieValue(0));

    const valid = await isValidCsrfToken(key, token, [cookieValue(0)]);

    expect(valid, "valid").toBe(true);
  });

  it("isValidCsrfToken accepts the token of the fourth cookie value", async () => {
    const key = await csrfKey(SECRET_A);
    const token = await csrfTokenFor(key, cookieValue(3));

    const valid = await isValidCsrfToken(key, token, [cookieValue(0), cookieValue(1), cookieValue(2), cookieValue(3)]);

    expect(valid, "valid").toBe(true);
  });

  it.each([
    { name: "null", token: () => Promise.resolve(null), values: [cookieValue(0)] },
    { name: "an empty token", token: () => Promise.resolve(""), values: [cookieValue(0)] },
    {
      name: "the token of another cookie value",
      token: (key: CryptoKey) => csrfTokenFor(key, cookieValue(1)),
      values: [cookieValue(0)],
    },
    {
      name: "a token under another key",
      token: async () => csrfTokenFor(await csrfKey(SECRET_B), cookieValue(0)),
      values: [cookieValue(0)],
    },
    {
      name: "a malformed cookie value",
      token: (key: CryptoKey) => csrfTokenFor(key, "short"),
      values: ["short"],
    },
    {
      name: "the token of the fifth cookie value",
      token: (key: CryptoKey) => csrfTokenFor(key, cookieValue(4)),
      values: [cookieValue(0), cookieValue(1), cookieValue(2), cookieValue(3), cookieValue(4)],
    },
    {
      name: "the valid token with its last character changed only in its two unused bits",
      token: async (key: CryptoKey) => withUnusedBitFlipped(await csrfTokenFor(key, cookieValue(0))),
      values: [cookieValue(0)],
    },
  ])("isValidCsrfToken rejects $name", async ({ token, values }) => {
    const key = await csrfKey(SECRET_A);
    const text = await token(key);

    const valid = await isValidCsrfToken(key, text, values);

    expect(valid, "valid").toBe(false);
  });
});
