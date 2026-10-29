import type { GrantedAccess } from "./app-info";
import type { GitHubFetch } from "./conversion";
import { gitHubRequest, sendGitHub } from "./http";

export const MAX_INSTALLATIONS = 100;

export type InstallationAccount =
  | { readonly kind: "login"; readonly login: string; readonly type: string | undefined }
  | { readonly kind: "enterprise"; readonly slug: string }
  | { readonly kind: "unknown" };

export interface Installation {
  readonly id: number;
  readonly account: InstallationAccount;
  readonly repositorySelection: "all" | "selected";
  readonly suspended: boolean;
  /** What the installation was granted; `undefined` when the answer's `permissions` or `events` are unusable. */
  readonly access: GrantedAccess | undefined;
}

export type InstallationsResult =
  | { readonly kind: "listed"; readonly installations: readonly Installation[]; readonly more: boolean }
  | { readonly kind: "failed" };

const REL_PREFIX = 'rel="';
const FAILED: InstallationsResult = { kind: "failed" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseAccount(account: Record<string, unknown>): InstallationAccount {
  const { login, type, slug } = account;
  if (typeof login === "string") {
    return { kind: "login", login, type: typeof type === "string" ? type : undefined };
  }
  return typeof slug === "string" ? { kind: "enterprise", slug } : { kind: "unknown" };
}

function parseInstallation(entry: unknown): Installation | undefined {
  if (!isRecord(entry)) {
    return undefined;
  }
  const { id, account, repository_selection: selection, suspended_at: suspendedAt } = entry;
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 1) {
    return undefined;
  }
  if (selection !== "all" && selection !== "selected") {
    return undefined;
  }
  if (account !== null && !isRecord(account)) {
    return undefined;
  }
  return {
    id,
    account: account === null ? { kind: "unknown" } : parseAccount(account),
    repositorySelection: selection,
    suspended: suspendedAt !== undefined && suspendedAt !== null,
    access: undefined,
  };
}

/** The narrowed installations list, or `undefined` when any entry has another shape. */
export function parseInstallations(body: unknown): readonly Installation[] | undefined {
  if (!Array.isArray(body)) {
    return undefined;
  }
  const installations: Installation[] = [];
  for (const entry of body as unknown[]) {
    // `Array.isArray` narrows to `any[]`; the entries are narrowed one by one below.
    const installation = parseInstallation(entry);
    if (installation === undefined) {
      return undefined;
    }
    installations.push(installation);
  }
  return installations;
}

/** Whether one `Link` parameter is `rel="..."` and its space-separated values include `next`. */
function isNextRelation(parameter: string): boolean {
  const text = parameter.trim().toLowerCase();
  return (
    text.startsWith(REL_PREFIX) && text.endsWith('"') && text.slice(REL_PREFIX.length, -1).split(" ").includes("next")
  );
}

/** Whether the `Link` header names a next page. */
export function hasNextPage(link: string | null): boolean {
  let position = 0;
  while (link !== null) {
    // Each link is `<target>` followed by its `;` parameters up to the next `<`; a target is skipped whole.
    const targetStart = link.indexOf("<", position);
    const targetEnd = targetStart < 0 ? -1 : link.indexOf(">", targetStart);
    if (targetEnd < 0) {
      return false;
    }
    const nextStart = link.indexOf("<", targetEnd);
    const parameters = link.slice(targetEnd + 1, nextStart < 0 ? link.length : nextStart).split(/[;,]/);
    if (parameters.some((parameter) => isNextRelation(parameter))) {
      return true;
    }
    if (nextStart < 0) {
      return false;
    }
    position = nextStart;
  }
  return false;
}

/** The app's first 100 installations, asked with the app JWT `jwt`. Never throws. */
export async function listInstallations(
  fetcher: GitHubFetch,
  version: string,
  jwt: string,
): Promise<InstallationsResult> {
  try {
    const reply = await sendGitHub(
      fetcher,
      gitHubRequest("GET", `/app/installations?per_page=${String(MAX_INSTALLATIONS)}`, version, jwt),
    );
    if (reply.kind !== "ok") {
      return FAILED;
    }
    const installations = parseInstallations(reply.body);
    return installations === undefined
      ? FAILED
      : { kind: "listed", installations: installations.slice(0, MAX_INSTALLATIONS), more: hasNextPage(reply.link) };
  } catch {
    // Failures carry nothing the caller can use; the cause is dropped.
    return FAILED;
  }
}
