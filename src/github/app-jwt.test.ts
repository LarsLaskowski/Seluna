import { describe, expect, it } from "vitest";
import { appJwt } from "./app-jwt";
import { decodeJwt, fixturePublicKey, fixtureSigningKey, jwtVerifies } from "../../test/jwt";
import type { DecodedJwt } from "../../test/jwt";

const APP_ID = 12_345;
/** 2026-10-19T12:00:00.999Z: a time with milliseconds, so the claims show how they are cut to whole seconds. */
const NOW = new Date(1_792_411_200_999);
const NOW_SECONDS = 1_792_411_200;

async function signed(appId = APP_ID, now = NOW): Promise<DecodedJwt> {
  const token = await appJwt(await fixtureSigningKey(), appId, now);
  const decoded = decodeJwt(token);
  if (decoded === undefined) {
    throw new Error(`appJwt returned something that is no JWT: ${token}`);
  }
  return decoded;
}

describe("appJwt", () => {
  it("appJwt writes the header {alg: RS256, typ: JWT}", async () => {
    const jwt = await signed();

    expect(jwt.headerText, "header text").toBe('{"alg":"RS256","typ":"JWT"}');
  });

  it("appJwt writes the claims iat now - 60 s, exp now + 540 s and iss the App ID in whole seconds", async () => {
    const jwt = await signed();

    expect(jwt.claims, "claims").toEqual({ iat: NOW_SECONDS - 60, exp: NOW_SECONDS + 540, iss: APP_ID });
  });

  it("appJwt takes its claims from the time it is given", async () => {
    const jwt = await signed(987, new Date((NOW_SECONDS + 3600) * 1000));

    expect(jwt.claims, "claims").toEqual({ iat: NOW_SECONDS + 3540, exp: NOW_SECONDS + 4140, iss: 987 });
  });

  it("appJwt writes three base64url parts without padding", async () => {
    const token = await appJwt(await fixtureSigningKey(), APP_ID, NOW);

    expect(token, "token").toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
  });

  it("appJwt's signature verifies with the documented key's public key", async () => {
    const jwt = await signed();

    const verifies = await jwtVerifies(jwt);

    expect(verifies, "signature verifies").toBe(true);
  });

  it("appJwt's signature does not verify for another payload", async () => {
    const jwt = await signed();
    const other = await signed(APP_ID + 1);

    const verifies = await crypto.subtle.verify(
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      await fixturePublicKey(),
      jwt.signature,
      new TextEncoder().encode(other.signingInput),
    );

    expect(verifies, "signature of one JWT verifies another's payload").toBe(false);
  });
});
