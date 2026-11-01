import { MESSAGE_TEXTS } from "./i18n/messages";
import type { MessageTexts } from "./i18n/messages";
import { buttonUrl, cleanField, MAX_LINE_CHARACTERS, MAX_TITLE_CHARACTERS } from "./message";
import type { StoredNotification } from "./notification";
import type { Language } from "./setup/language";

/** One repository's line of the activity digest. */
export interface DigestRepository {
  readonly repositoryId: number;
  readonly repository: string;
  readonly repositoryUrl: string | undefined;
  readonly stars: number;
  readonly forks: number;
  /** The star count of the newest collected star; `undefined` when none is known. */
  readonly starCount: number | undefined;
  /** The number of distinct accounts. */
  readonly accounts: number;
  /** The first events' account logins, at most `DIGEST_MAX_NAMES`. */
  readonly names: readonly string[];
}

/** The collected activity a digest reports. */
export interface DigestSummary {
  /** The largest `activity` id the summary counts; rows up to it are deleted when the digest is committed. */
  readonly maxId: number;
  readonly repositories: readonly DigestRepository[];
  /** The number of repositories with activity, which may exceed `repositories.length`. */
  readonly totalRepositories: number;
}

/** The most repositories a digest lists. */
export const DIGEST_MAX_REPOSITORIES = 10;
/** The most account names a repository line lists. */
export const DIGEST_MAX_NAMES = 5;

/** The most UTF-16 code units the title, the lines and the line feeds between them take. */
const MAX_DIGEST_UNITS = 4000;

function repositoryLine(repository: DigestRepository, texts: MessageTexts): string {
  const parts: string[] = [];
  if (repository.stars > 0) {
    parts.push(texts.digestStars(repository.stars, repository.starCount));
  }
  if (repository.forks > 0) {
    parts.push(texts.digestForks(repository.forks));
  }
  const left = parts.length === 0 ? repository.repository : `${repository.repository}: ${parts.join(", ")}`;
  const unnamed = repository.accounts - repository.names.length;
  const names = repository.names.join(", ");
  const right = unnamed > 0 ? `${names} ${texts.moreNames(unnamed)}`.trim() : names;
  return cleanField(right === "" ? left : `${left} · ${right}`, MAX_LINE_CHARACTERS);
}

function unitsOf(title: string, lines: readonly string[]): number {
  return title.length + lines.reduce((sum, line) => sum + line.length + 1, 0);
}

/**
 * The activity digest of `summary` in `language`, and the button URL (the repository's `buttonUrl` for exactly one
 * repository, otherwise `undefined`). Repository lines are dropped from the end, and counted into the last line,
 * until the title and lines hold at most 4,000 UTF-16 code units.
 */
export function digestNotification(
  summary: DigestSummary,
  language: Language,
): { readonly notification: StoredNotification; readonly buttonUrl: string | undefined } {
  const texts = MESSAGE_TEXTS[language];
  const title = cleanField(texts.activityDigestTitle, MAX_TITLE_CHARACTERS);
  const listed = summary.repositories.slice(0, DIGEST_MAX_REPOSITORIES);
  const repositoryLines = listed.map((repository) => repositoryLine(repository, texts));
  const withLast = (): string[] => {
    const hidden = summary.totalRepositories - repositoryLines.length;
    return hidden > 0
      ? [...repositoryLines, cleanField(texts.moreRepositories(hidden), MAX_LINE_CHARACTERS)]
      : [...repositoryLines];
  };
  let lines = withLast();
  while (repositoryLines.length > 0 && unitsOf(title, lines) > MAX_DIGEST_UNITS) {
    repositoryLines.pop();
    lines = withLast();
  }
  const only = summary.totalRepositories === 1 ? listed[0] : undefined;
  return {
    notification: { title, repository: "", number: undefined, subject: "", context: "", lines },
    buttonUrl: only?.repositoryUrl === undefined ? undefined : buttonUrl(only.repositoryUrl),
  };
}
