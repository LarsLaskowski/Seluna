import { describe, expect, it } from "vitest";
import { body, headers, secret } from "../test/fixtures/ping/form-delivery.json";
import { verifySignature } from "./signature";

const BYTES = new TextEncoder().encode(body);
const HEADER = headers["x-hub-signature-256"];
const DIGEST = HEADER.slice("sha256=".length);

function withFirstByteChanged(): Uint8Array {
  const changed = BYTES.slice();
  changed[0] = (changed[0] ?? 0) + 1;
  return changed;
}

function withNewline(): Uint8Array {
  return new TextEncoder().encode(`${body}\n`);
}

describe("verifySignature", () => {
  it("verifySignature returns true for the real GitHub ping delivery", async () => {
    const result = await verifySignature(BYTES, HEADER, secret);

    expect(result, "result").toBe(true);
  });

  it("verifySignature returns false when the header is missing", async () => {
    const result = await verifySignature(BYTES, null, secret);

    expect(result, "result").toBe(false);
  });

  it.each([
    { case: "the body with a trailing newline", bytes: withNewline(), header: HEADER, key: secret },
    { case: "the body with one byte changed", bytes: withFirstByteChanged(), header: HEADER, key: secret },
    { case: "a different secret", bytes: BYTES, header: HEADER, key: "my-secret2" },
    { case: "the last hex digit changed", bytes: BYTES, header: `sha256=${DIGEST.slice(0, -1)}6`, key: secret },
    { case: "the SHA-1 signature", bytes: BYTES, header: headers["x-hub-signature"], key: secret },
    {
      case: "the SHA-1 digest under the sha256 prefix",
      bytes: BYTES,
      header: `sha256=${headers["x-hub-signature"].slice("sha1=".length)}`,
      key: secret,
    },
    { case: "an uppercase prefix", bytes: BYTES, header: `SHA256=${DIGEST}`, key: secret },
    { case: "uppercase hex digits", bytes: BYTES, header: `sha256=${DIGEST.toUpperCase()}`, key: secret },
    { case: "an empty digest", bytes: BYTES, header: "sha256=", key: secret },
    { case: "63 hex digits", bytes: BYTES, header: HEADER.slice(0, -1), key: secret },
    { case: "65 hex digits", bytes: BYTES, header: `${HEADER}0`, key: secret },
    { case: "a non-hex digit", bytes: BYTES, header: `sha256=g${DIGEST.slice(1)}`, key: secret },
    { case: "the digest without prefix", bytes: BYTES, header: DIGEST, key: secret },
    { case: "two values joined by a comma", bytes: BYTES, header: `${HEADER}, ${HEADER}`, key: secret },
    { case: "an empty header", bytes: BYTES, header: "", key: secret },
  ])("verifySignature returns false for $case", async ({ bytes, header, key }) => {
    const result = await verifySignature(bytes, header, key);

    expect(result, "result").toBe(false);
  });

  it("verifySignature returns false for an empty secret", async () => {
    const result = await verifySignature(BYTES, HEADER, "");

    expect(result, "result").toBe(false);
  });

  it("the real delivery fixture body is 9523 bytes of UTF-8", () => {
    expect(BYTES.length, "byte length").toBe(9523);
    expect(body.length, "character length").toBe(9523);
  });
});
