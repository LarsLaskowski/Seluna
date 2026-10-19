import { describe, expect, it } from "vitest";
import { importSigningKey, MAX_SIGNING_KEY_BITS, toPkcs8Pem } from "./private-key";
import { FIXTURE_PEM, FIXTURE_PKCS8, RSA_4096_PKCS8, RSA_4104_PKCS8 } from "../../test/github";

const PKCS8_ALGORITHM = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;

/** The DER bytes of the first PEM block of `pem`, decoded independently of `src/`. */
function derOf(pem: string): Uint8Array<ArrayBuffer> {
  const base64 = pem.replaceAll(/-----[A-Z ]+-----|\s/g, "");
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

/** A PEM block with `label` around `der`, in lines of 64 characters and a final line feed. */
function pemOf(label: string, der: Uint8Array): string {
  const base64 = btoa(Array.from(der, (byte) => String.fromCharCode(byte)).join(""));
  const lines = base64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`;
}

/** `der` with the byte at `index` replaced by another value. */
function withByteChanged(der: Uint8Array, index: number): Uint8Array {
  const copy = Uint8Array.from(der);
  copy[index] = (copy[index] ?? 0) ^ 0xff;
  return copy;
}

describe("toPkcs8Pem", () => {
  it("toPkcs8Pem converts the documented PKCS#1 key to the PKCS#8 PEM openssl writes", async () => {
    const pem = await toPkcs8Pem(FIXTURE_PEM);

    expect(pem, "PKCS#8 PEM").toBe(FIXTURE_PKCS8);
  });

  it("toPkcs8Pem returns a PKCS#8 PEM that imports as an RS256 signing key", async () => {
    const pem = await toPkcs8Pem(FIXTURE_PEM);

    expect(pem, "PKCS#8 PEM").toBeDefined();
    const key = await crypto.subtle.importKey("pkcs8", derOf(pem ?? ""), PKCS8_ALGORITHM, false, ["sign"]);
    expect(key.algorithm, "algorithm").toMatchObject({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048 });
    expect(key.usages, "usages").toEqual(["sign"]);
  });

  it("toPkcs8Pem passes a PKCS#8 key through in canonical form", async () => {
    const pem = await toPkcs8Pem(FIXTURE_PKCS8);

    expect(pem, "PKCS#8 PEM").toBe(FIXTURE_PKCS8);
  });

  it.each([
    { name: "CRLF line endings", pem: FIXTURE_PEM.replaceAll("\n", "\r\n") },
    { name: "a missing final newline", pem: FIXTURE_PEM.slice(0, -1) },
    { name: "CRLF line endings and a missing final newline", pem: FIXTURE_PEM.replaceAll("\n", "\r\n").slice(0, -2) },
  ])("toPkcs8Pem accepts CRLF line endings and a missing final newline: $name", async ({ pem }) => {
    const converted = await toPkcs8Pem(pem);

    expect(converted, "PKCS#8 PEM").toBe(FIXTURE_PKCS8);
  });

  it.each([
    { form: "empty text", pem: () => "" },
    { form: "text that is no PEM", pem: () => "not a pem" },
    { form: "armour ENCRYPTED PRIVATE KEY", pem: () => pemOf("ENCRYPTED PRIVATE KEY", derOf(FIXTURE_PKCS8)) },
    { form: "armour EC PRIVATE KEY", pem: () => pemOf("EC PRIVATE KEY", derOf(FIXTURE_PEM)) },
    { form: "armour PUBLIC KEY", pem: () => pemOf("PUBLIC KEY", derOf(FIXTURE_PKCS8)) },
    {
      form: "mismatched BEGIN and END",
      pem: () => FIXTURE_PEM.replace("-----END RSA PRIVATE KEY-----", "-----END PRIVATE KEY-----"),
    },
    { form: "text before the BEGIN line", pem: () => `key:\n${FIXTURE_PEM}` },
    { form: "text after the END line", pem: () => `${FIXTURE_PEM}key\n` },
    { form: "two final line breaks", pem: () => `${FIXTURE_PEM}\n` },
    { form: "two keys", pem: () => FIXTURE_PEM + FIXTURE_PEM },
    { form: "a character that is no base64", pem: () => FIXTURE_PEM.replace("MIIEowIBAAKCAQEA", "MIIEowIBAAKC*QEA") },
    { form: "a base64url hyphen", pem: () => FIXTURE_PKCS8.replace("+", "-") },
    { form: "a base64url underscore", pem: () => FIXTURE_PKCS8.replace("/", "_") },
    { form: "padding inside the body", pem: () => FIXTURE_PKCS8.replace("MIIEvQIBADAN", "MIIE=QIBADAN") },
    { form: "an empty line inside the body", pem: () => FIXTURE_PKCS8.replace("\nYuIx4HK1", "\n\nYuIx4HK1") },
    { form: "non-canonical base64", pem: () => FIXTURE_PKCS8.replace("51a4=\n", "51a5=\n") },
    {
      form: "more than 16,384 characters",
      pem: () => pemOf("PRIVATE KEY", new Uint8Array(12_500).fill(0x41)),
    },
    { form: "an empty body", pem: () => "-----BEGIN PRIVATE KEY-----\n-----END PRIVATE KEY-----\n" },
    {
      form: "a PKCS#1 body with one byte of its outer length changed",
      pem: () => pemOf("RSA PRIVATE KEY", withByteChanged(derOf(FIXTURE_PEM), 3)),
    },
    { form: "a truncated PKCS#1 body", pem: () => pemOf("RSA PRIVATE KEY", derOf(FIXTURE_PEM).slice(0, 100)) },
    { form: "a truncated PKCS#8 body", pem: () => pemOf("PRIVATE KEY", derOf(FIXTURE_PKCS8).slice(0, 100)) },
    {
      form: "a legacy encrypted PKCS#1 key",
      pem: () =>
        `-----BEGIN RSA PRIVATE KEY-----\nProc-Type: 4,ENCRYPTED\nDEK-Info: AES-128-CBC,0123456789ABCDEF0123456789ABCDEF\n\n${FIXTURE_PEM.split("\n").slice(1, -2).join("\n")}\n-----END RSA PRIVATE KEY-----\n`,
    },
  ])("toPkcs8Pem rejects every form in the PEM table: $form", async ({ pem }) => {
    const converted = await toPkcs8Pem(pem());

    expect(converted, "PKCS#8 PEM").toBeUndefined();
  });

  it("toPkcs8Pem rejects the documented key behind a byte order mark", async () => {
    const pem = `\uFEFF${FIXTURE_PEM}`;
    expect(pem.charCodeAt(0), "first code unit of the input").toBe(0xfe_ff);

    const converted = await toPkcs8Pem(pem);

    expect(converted, "PKCS#8 PEM").toBeUndefined();
  });
});

describe("importSigningKey", () => {
  it.each([
    { form: "PKCS#1", pem: FIXTURE_PEM },
    { form: "PKCS#8", pem: FIXTURE_PKCS8 },
  ])("importSigningKey imports the documented key as $form", async ({ pem }) => {
    const key = await importSigningKey(pem);

    expect(key, "signing key").toBeDefined();
    expect(key?.algorithm, "algorithm").toMatchObject({
      name: "RSASSA-PKCS1-v1_5",
      hash: { name: "SHA-256" },
      modulusLength: 2048,
    });
    expect(key?.usages, "usages").toEqual(["sign"]);
    expect(key?.extractable, "extractable").toBe(false);
  });

  it("importSigningKey returns a key that signs the same bytes as the PKCS#8 form of the documented key", async () => {
    const fromPkcs1 = await importSigningKey(FIXTURE_PEM);
    const fromPkcs8 = await importSigningKey(FIXTURE_PKCS8);
    const data = new TextEncoder().encode("header.claims");

    const first = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", fromPkcs1 ?? failedImport(), data);
    const second = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", fromPkcs8 ?? failedImport(), data);

    expect(new Uint8Array(first), "signature of the PKCS#1 import").toEqual(new Uint8Array(second));
  });

  it("importSigningKey accepts an RSA key of exactly MAX_SIGNING_KEY_BITS bits", async () => {
    const key = await importSigningKey(RSA_4096_PKCS8);

    expect(MAX_SIGNING_KEY_BITS, "limit").toBe(4096);
    expect(key?.algorithm, "algorithm").toMatchObject({ modulusLength: 4096 });
  });

  it("importSigningKey rejects an RSA key of more than 4096 bits", async () => {
    const key = await importSigningKey(RSA_4104_PKCS8);

    expect(key, "signing key").toBeUndefined();
  });

  it.each([
    { form: "empty text", pem: () => "" },
    { form: "text that is no PEM", pem: () => "not a pem" },
    { form: "armour PUBLIC KEY", pem: () => pemOf("PUBLIC KEY", derOf(FIXTURE_PKCS8)) },
    { form: "armour ENCRYPTED PRIVATE KEY", pem: () => pemOf("ENCRYPTED PRIVATE KEY", derOf(FIXTURE_PKCS8)) },
    { form: "text before the BEGIN line", pem: () => `key:\n${FIXTURE_PEM}` },
    { form: "non-canonical base64", pem: () => FIXTURE_PKCS8.replace("51a4=\n", "51a5=\n") },
    { form: "a truncated PKCS#8 body", pem: () => pemOf("PRIVATE KEY", derOf(FIXTURE_PKCS8).slice(0, 100)) },
    { form: "a PKCS#1 body that is no key", pem: () => pemOf("RSA PRIVATE KEY", new Uint8Array(300).fill(0x41)) },
    { form: "more than 16,384 characters", pem: () => pemOf("PRIVATE KEY", new Uint8Array(12_500).fill(0x41)) },
  ])("importSigningKey returns undefined without throwing for $form", async ({ pem }) => {
    const key = await importSigningKey(pem());

    expect(key, "signing key").toBeUndefined();
  });
});

function failedImport(): never {
  throw new Error("importSigningKey returned no key");
}
