/** The PKCS#8 PEM of an RSA key given as PKCS#1 or PKCS#8 PEM, or `undefined` unless it imports as an RS256 signing key. Never throws. */
export async function toPkcs8Pem(_pem: string): Promise<string | undefined> {
  throw new Error("Not implemented");
}
