import type { DigestRepository, DigestSummary } from "../digest";
import { DIGEST_MAX_NAMES, DIGEST_MAX_REPOSITORIES } from "../digest";
import { buttonUrl, cleanField } from "../message";
import type { ActivityEvent, StarRemoval } from "../rules/rule";

/** How long collected activity is kept: seven days in milliseconds. */
export const ACTIVITY_RETENTION_MS = 604_800_000;

const MAX_LOGIN_CHARACTERS = 64;
const MAX_REPOSITORY_CHARACTERS = 140;

/** The insert of `event` into `activity`, with `createdAt` as its time, for a batch. */
export function activityInsert(db: D1Database, event: ActivityEvent, createdAt: Date): D1PreparedStatement {
  return db
    .prepare(
      "INSERT INTO activity (kind, sender_id, sender_login, repository_id, repository, repository_url, star_count, created_at) " +
        "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
    )
    .bind(
      event.kind,
      event.senderId,
      cleanField(event.senderLogin, MAX_LOGIN_CHARACTERS),
      event.repositoryId,
      cleanField(event.repository, MAX_REPOSITORY_CHARACTERS),
      buttonUrl(event.repositoryUrl) ?? null,
      event.kind === "star" ? (event.starCount ?? null) : null,
      createdAt.getTime(),
    );
}

/** The delete of the star rows of `removal`'s account in its repository, for a batch. */
export function starRemovalDelete(db: D1Database, removal: StarRemoval): D1PreparedStatement {
  return db
    .prepare("DELETE FROM activity WHERE kind = 'star' AND repository_id = ?1 AND sender_id = ?2")
    .bind(removal.repositoryId, removal.senderId);
}

/** The newest row of the repository within the summarized rows, by id. */
function newest(column: string, extraCondition = ""): string {
  return (
    `(SELECT n.${column} FROM activity n WHERE n.repository_id = a.repository_id AND n.id <= ?1 ` +
    `AND n.created_at >= ?2${extraCondition} ORDER BY n.id DESC LIMIT 1)`
  );
}

const REPOSITORIES_SQL =
  "SELECT a.repository_id AS repository_id, " +
  "SUM(a.kind = 'star') AS stars, SUM(a.kind = 'fork') AS forks, COUNT(DISTINCT a.sender_id) AS accounts, " +
  "COUNT(*) OVER () AS total, " +
  `${newest("repository")} AS repository, ${newest("repository_url")} AS repository_url, ` +
  `${newest("star_count", " AND n.kind = 'star'")} AS star_count ` +
  "FROM activity a WHERE a.id <= ?1 AND a.created_at >= ?2 GROUP BY a.repository_id " +
  "ORDER BY stars + forks DESC, repository LIMIT ?3";

function namesSql(repositoryCount: number): string {
  const marks = Array.from({ length: repositoryCount }, (_, index) => `?${String(index + 4)}`).join(", ");
  return (
    "SELECT repository_id, sender_login FROM (" +
    "SELECT repository_id, sender_login, " +
    "ROW_NUMBER() OVER (PARTITION BY repository_id ORDER BY MIN(id)) AS rn " +
    `FROM activity WHERE id <= ?1 AND created_at >= ?2 AND repository_id IN (${marks}) ` +
    "GROUP BY repository_id, sender_id) WHERE rn <= ?3 ORDER BY repository_id, rn"
  );
}

function numberOf(value: unknown): number {
  if (typeof value !== "number") {
    throw new TypeError("The activity read returned a value that is not a number");
  }
  return value;
}

function stringOf(value: unknown): string {
  if (typeof value !== "string") {
    throw new TypeError("The activity read returned a value that is not a string");
  }
  return value;
}

/**
 * The summary of the activity rows created at or after `notBefore`, or `undefined` for an empty table.
 * D1 errors are not caught.
 */
export async function readDigestSummary(db: D1Database, notBefore: Date): Promise<DigestSummary | undefined> {
  const maxRow = await db.prepare("SELECT MAX(id) AS max_id FROM activity").first();
  const maxValue = maxRow?.max_id;
  if (maxValue === null || maxValue === undefined) {
    return undefined;
  }
  const maxId = numberOf(maxValue);
  const since = notBefore.getTime();
  const { results } = await db.prepare(REPOSITORIES_SQL).bind(maxId, since, DIGEST_MAX_REPOSITORIES).all();
  if (results.length === 0) {
    return { maxId, repositories: [], totalRepositories: 0 };
  }
  const repositoryIds = results.map((row) => numberOf(row.repository_id));
  const names = await db
    .prepare(namesSql(repositoryIds.length))
    .bind(maxId, since, DIGEST_MAX_NAMES, ...repositoryIds)
    .all();
  const namesOf = new Map<number, string[]>();
  for (const row of names.results) {
    const id = numberOf(row.repository_id);
    namesOf.set(id, [...(namesOf.get(id) ?? []), stringOf(row.sender_login)]);
  }
  const repositories = results.map((row): DigestRepository => {
    const repositoryId = numberOf(row.repository_id);
    const url = row.repository_url;
    const count = row.star_count;
    return {
      repositoryId,
      repository: stringOf(row.repository),
      repositoryUrl: typeof url === "string" ? url : undefined,
      stars: numberOf(row.stars),
      forks: numberOf(row.forks),
      starCount: typeof count === "number" ? count : undefined,
      accounts: numberOf(row.accounts),
      names: namesOf.get(repositoryId) ?? [],
    };
  });
  return { maxId, repositories, totalRepositories: numberOf(results[0]?.total) };
}

/** The delete of every `activity` row with an id up to `maxId`, for a batch. */
export function countedActivityDelete(db: D1Database, maxId: number): D1PreparedStatement {
  return db.prepare("DELETE FROM activity WHERE id <= ?1").bind(maxId);
}

/** The bounded delete of `activity` rows created before `createdBefore`, oldest first, for a batch. */
export function oldActivityDelete(db: D1Database, createdBefore: Date, limit: number): D1PreparedStatement {
  return db
    .prepare(
      "DELETE FROM activity WHERE id IN (SELECT id FROM activity WHERE created_at < ?1 " +
        "ORDER BY created_at, id LIMIT ?2)",
    )
    .bind(createdBefore.getTime(), limit);
}
