import { afterEach, describe, expect, it, vi } from "vitest";
import { CHAT_PROOF_LIFETIME_MS, checkChatProof, createChatProof, newChatCode } from "./chat-proof";
import { hmacBase64Url, signingKeyFor, withUnusedBitFlipped } from "../../test/keys";

const SECRET = "throwaway-setup-secret-0123456789abcdef";
const OTHER_SECRET = "another-throwaway-secret-fedcba9876543210";
const NOW = new Date(1_700_000_000_000);
const SESSION = "v1.1700043200000.sessionmacsessionmacsessionmacsessionmac1";
const OTHER_SESSION = "v1.1700043100000.othermacothermacothermacothermacother1";
const CODE = "123456";
const PRIVATE_CHAT = 5_001_001;
const GROUP_CHAT = -1_001_234_567_890;

afterEach(() => {
  vi.restoreAllMocks();
});

function keyOf(secret: string = SECRET): Promise<CryptoKey> {
  return signingKeyFor(secret, "setup-telegram");
}

/** A proof for `chatId` and `code`, created `ageMs` before `NOW`, under the key of `secret`. */
async function proofOf(
  chatId: number = PRIVATE_CHAT,
  code: string = CODE,
  options: { readonly ageMs?: number; readonly secret?: string; readonly session?: string } = {},
): Promise<string> {
  const createdAt = new Date(NOW.getTime() - (options.ageMs ?? 0));
  return createChatProof(await keyOf(options.secret), options.session ?? SESSION, chatId, code, createdAt);
}

/** The four dot-separated segments of a proof (version, chat id, expiry, MAC). */
function segmentsOf(proof: string): [string, string, string, string] {
  const [version = "", chat = "", expires = "", mac = ""] = proof.split(".");
  return [version, chat, expires, mac];
}

/** Makes `crypto.getRandomValues` fill the first element of a Uint32Array with each of `values` in turn. */
function drawValues(values: readonly number[]): void {
  const queue = [...values];
  vi.spyOn(crypto, "getRandomValues").mockImplementation(<T extends ArrayBufferView | null>(array: T): T => {
    if (array instanceof Uint32Array) {
      array[0] = queue.shift() ?? 0;
    }
    return array;
  });
}

describe("newChatCode", () => {
  it("newChatCode returns six decimal digits", () => {
    const codes = Array.from({ length: 200 }, () => newChatCode());

    expect(
      codes.filter((code) => !/^\d{6}$/.test(code)),
      "codes that are not six decimal digits",
    ).toEqual([]);
  });

  it.each([
    { name: "zero-padded", draws: [42], expected: "000042" },
    { name: "the modulo of a draw", draws: [123_456_789], expected: "456789" },
    { name: "the largest accepted draw", draws: [4_293_999_999], expected: "999999" },
    { name: "a redraw of 4,294,000,000", draws: [4_294_000_000, 7], expected: "000007" },
    { name: "a redraw of the largest Uint32", draws: [4_294_967_295, 4_294_000_001, 1_000_001], expected: "000001" },
  ])("newChatCode draws uniformly: $name", ({ draws, expected }) => {
    drawValues(draws);

    const code = newChatCode();

    expect(code, "code").toBe(expected);
  });
});

describe("createChatProof", () => {
  it("createChatProof returns v1.<chatId>.<expires>.<mac> with the HMAC of the documented text", async () => {
    const expires = NOW.getTime() + CHAT_PROOF_LIFETIME_MS;
    const mac = await hmacBase64Url(
      await keyOf(),
      `chat-proof.v1.${String(PRIVATE_CHAT)}.${String(expires)}.${SESSION}.${CODE}`,
    );

    const proof = await proofOf();

    expect(proof, "proof").toBe(`v1.${String(PRIVATE_CHAT)}.${String(expires)}.${mac}`);
    expect(mac.length, "length of the MAC").toBe(43);
  });

  it("createChatProof writes a negative group id and a lifetime of 600,000 ms", async () => {
    const expires = NOW.getTime() + 600_000;

    const proof = await proofOf(GROUP_CHAT);

    expect(segmentsOf(proof).slice(0, 3), "version, chat id and expiry").toEqual([
      "v1",
      String(GROUP_CHAT),
      String(expires),
    ]);
  });
});

describe("checkChatProof", () => {
  it.each([
    { name: "a private chat", chatId: PRIVATE_CHAT },
    { name: "a group", chatId: GROUP_CHAT },
  ])("checkChatProof accepts the code and session the proof was made for: $name", async ({ chatId }) => {
    const proof = await proofOf(chatId);

    const check = await checkChatProof(await keyOf(), proof, SESSION, CODE, NOW);

    expect(check, "check").toEqual({ kind: "valid", chatId });
  });

  it("checkChatProof accepts a proof made at the same instant and one that expires in one millisecond", async () => {
    const fresh = await proofOf();
    const nearlyExpired = await proofOf(PRIVATE_CHAT, CODE, { ageMs: CHAT_PROOF_LIFETIME_MS - 1 });

    const checks = [
      await checkChatProof(await keyOf(), fresh, SESSION, CODE, NOW),
      await checkChatProof(await keyOf(), nearlyExpired, SESSION, CODE, NOW),
    ];

    expect(
      checks.map((check) => check.kind),
      "kinds",
    ).toEqual(["valid", "valid"]);
  });

  it.each([
    { name: "another code", code: () => "654321", session: SESSION, secret: SECRET },
    { name: "a code with another last digit", code: () => "123457", session: SESSION, secret: SECRET },
    { name: "another session", code: () => CODE, session: OTHER_SESSION, secret: SECRET },
    { name: "another key", code: () => CODE, session: SESSION, secret: OTHER_SECRET },
  ])(
    "checkChatProof reports wrong-code for another code, another chat id, another session and another key: $name",
    async ({ code, session, secret }) => {
      const proof = await proofOf();

      const check = await checkChatProof(await keyOf(secret), proof, session, code(), NOW);

      expect(check, "check").toEqual({ kind: "wrong-code", chatId: PRIVATE_CHAT });
    },
  );

  it("checkChatProof reports wrong-code for another code, another chat id, another session and another key: another chat id", async () => {
    const [version, , expires, mac] = segmentsOf(await proofOf(PRIVATE_CHAT));
    const altered = [version, "5002002", expires, mac].join(".");

    const check = await checkChatProof(await keyOf(), altered, SESSION, CODE, NOW);

    expect(check, "check names the altered chat id but does not accept it").toEqual({
      kind: "wrong-code",
      chatId: 5_002_002,
    });
  });

  it("checkChatProof reports wrong-code for another code, another chat id, another session and another key: the code of another chat", async () => {
    const proofOfB = await proofOf(5_002_002, "654321");

    const check = await checkChatProof(await keyOf(), proofOfB, SESSION, CODE, NOW);

    expect(check, "check").toEqual({ kind: "wrong-code", chatId: 5_002_002 });
  });

  it.each([
    { name: "empty", code: "" },
    { name: "five digits", code: "12345" },
    { name: "seven digits", code: "1234567" },
    { name: "letters", code: "12345a" },
    { name: "a leading space", code: " 12345" },
    { name: "a trailing line feed", code: "12345\n" },
    { name: "non-ASCII digits", code: "١٢٣٤٥٦" },
  ])("checkChatProof reports wrong-code for a code that is not six digits: $name", async ({ code }) => {
    const proof = await proofOf(PRIVATE_CHAT, code);

    const check = await checkChatProof(await keyOf(), proof, SESSION, code, NOW);

    expect(check, "check, although the MAC matches the text").toEqual({ kind: "wrong-code", chatId: PRIVATE_CHAT });
  });

  it.each([
    { name: "a proof that expires now", ageMs: CHAT_PROOF_LIFETIME_MS },
    { name: "a proof that expired a millisecond ago", ageMs: CHAT_PROOF_LIFETIME_MS + 1 },
    { name: "a proof that expired an hour ago", ageMs: 3_600_000 },
    { name: "a proof that expires 600,001 ms ahead", ageMs: -1 },
    { name: "a proof that expires an hour ahead", ageMs: -3_600_000 },
  ])(
    "checkChatProof reports invalid for an expired proof and for an expiry more than 10 minutes ahead: $name",
    async ({ ageMs }) => {
      const proof = await proofOf(PRIVATE_CHAT, CODE, { ageMs });

      const check = await checkChatProof(await keyOf(), proof, SESSION, CODE, NOW);

      expect(check, "check, although code and session match").toEqual({ kind: "invalid" });
    },
  );

  it.each<{ name: string; alter: (parts: [string, string, string, string], proof: string) => string }>([
    { name: "empty", alter: () => "" },
    { name: "version v2", alter: ([, chat, expires, mac]) => ["v2", chat, expires, mac].join(".") },
    { name: "no version", alter: ([, chat, expires, mac]) => [chat, expires, mac].join(".") },
    { name: "chat id 0", alter: ([version, , expires, mac]) => [version, "0", expires, mac].join(".") },
    { name: "chat id +1", alter: ([version, , expires, mac]) => [version, "+1", expires, mac].join(".") },
    { name: "chat id 01", alter: ([version, , expires, mac]) => [version, "01", expires, mac].join(".") },
    { name: "chat id -0", alter: ([version, , expires, mac]) => [version, "-0", expires, mac].join(".") },
    {
      name: "a chat id of 17 digits",
      alter: ([version, , expires, mac]) => [version, "12345678901234567", expires, mac].join("."),
    },
    {
      name: "an unsafe chat id of 16 digits",
      alter: ([version, , expires, mac]) => [version, "9007199254740992", expires, mac].join("."),
    },
    { name: "expiry 0", alter: ([version, chat, , mac]) => [version, chat, "0", mac].join(".") },
    {
      name: "an expiry with a leading zero",
      alter: ([version, chat, expires, mac]) => [version, chat, `0${expires}`, mac].join("."),
    },
    {
      name: "an expiry of 16 digits",
      alter: ([version, chat, , mac]) => [version, chat, "1700000000000000", mac].join("."),
    },
    {
      name: "a MAC of 42 characters",
      alter: ([version, chat, expires, mac]) => [version, chat, expires, mac.slice(0, 42)].join("."),
    },
    {
      name: "a MAC of 44 characters",
      alter: ([version, chat, expires, mac]) => [version, chat, expires, `${mac}A`].join("."),
    },
    {
      name: "a MAC with a non-canonical last character",
      alter: ([version, chat, expires, mac]) => [version, chat, expires, withUnusedBitFlipped(mac)].join("."),
    },
    {
      name: "a MAC with = padding",
      alter: ([version, chat, expires, mac]) => [version, chat, expires, `${mac.slice(0, 42)}=`].join("."),
    },
    {
      name: "a MAC with a plus sign",
      alter: ([version, chat, expires, mac]) => [version, chat, expires, `${mac.slice(0, 42)}+`].join("."),
    },
    { name: "an extra segment", alter: (_, proof) => `${proof}.x` },
    { name: "an empty fifth segment", alter: (_, proof) => `${proof}.` },
    { name: "a leading space", alter: (_, proof) => ` ${proof}` },
    { name: "a trailing space", alter: (_, proof) => `${proof} ` },
    { name: "a trailing line feed", alter: (_, proof) => `${proof}\n` },
    { name: "a space inside", alter: ([version, chat, expires, mac]) => [version, chat, ` ${expires}`, mac].join(".") },
  ])("checkChatProof reports invalid for every malformed proof: $name", async ({ alter }) => {
    const proof = await proofOf();

    const check = await checkChatProof(await keyOf(), alter(segmentsOf(proof), proof), SESSION, CODE, NOW);

    expect(check, "check").toEqual({ kind: "invalid" });
  });
});
