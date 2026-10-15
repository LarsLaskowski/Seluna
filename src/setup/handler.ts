/** What the wizard needs from outside. */
export interface SetupDeps {
  /** The Worker environment; `SELUNA_SECRET` is read from it only through `src/crypto.ts`. */
  readonly env: object;
  readonly db: D1Database;
  readonly now: () => Date;
}

export const SETUP_PATH = "/setup";
export const LOGIN_PATH = "/setup/login";
export const LOGOUT_PATH = "/setup/logout";

/** Whether `pathname` is `/setup` or starts with `/setup/`. */
export function isSetupPath(pathname: string): boolean {
  throw new Error("Not implemented");
}

/** Answers a request under `/setup` as the area document `setup-wizard.md` describes. */
export function handleSetup(request: Request, pathname: string, deps: SetupDeps): Promise<Response> {
  throw new Error("Not implemented");
}
