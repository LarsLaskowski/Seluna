const TOKEN_TEXT = /^[A-Za-z0-9_.-]{1,4096}$/;

/**
 * Whether `text` has the form of an installation token, classic or stateless (`ghs_<App ID>_<JWT>`): 1 to 4096
 * characters from `[A-Za-z0-9_.-]`.
 */
export function isInstallationTokenText(text: string): boolean {
  return TOKEN_TEXT.test(text);
}
