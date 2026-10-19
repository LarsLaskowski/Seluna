export const JWT_BACKDATE_SECONDS = 60;
export const JWT_LIFETIME_SECONDS = 600;

/** The RS256 JWT that authenticates as the GitHub App `appId`, signed with `signingKey`, valid around `now`. */
export async function appJwt(signingKey: CryptoKey, appId: number, now: Date): Promise<string> {
  await Promise.resolve([signingKey, appId, now]);
  throw new Error("Not implemented");
}
