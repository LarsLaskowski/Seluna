const TOKEN_TEXT = /^\w{1,255}$/;

/** Whether `text` has the form of an installation token (`^[A-Za-z0-9_]{1,255}$`). */
export function isInstallationTokenText(text: string): boolean {
  return TOKEN_TEXT.test(text);
}
