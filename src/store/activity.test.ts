import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ACTIVITY_RETENTION_MS,
  activityInsert,
  countedActivityDelete,
  oldActivityDelete,
  readDigestSummary,
  starRemovalDelete,
} from "./activity";
import { DIGEST_MAX_NAMES, DIGEST_MAX_REPOSITORIES } from "../digest";
import type { ActivityEvent } from "../rules/rule";
import { applyMigrations, migrationTestDb } from "../../test/d1";

const NOW = 1_792_240_440_000;
const NOT_BEFORE = new Date(NOW - ACTIVITY_RETENTION_MS);

beforeEach(async () => {
  await applyMigrations(env.DB);
  await env.DB.prepare("DELETE FROM activity").run();
});

/** A star event of a foreign account; `changes` replace fields. */
function eventWith(changes: Partial<ActivityEvent> = {}): ActivityEvent {
  return {
    kind: "star",
    senderId: 1_000_002,
    senderLogin: "alice",
    repositoryId: 2000,
    repository: "octo/repo",
    repositoryUrl: "https://github.com/octo/repo",
    starCount: 5,
    ...changes,
  };
}

interface RowSpec {
  readonly kind?: "star" | "fork";
  readonly senderId?: number;
  readonly login?: string;
  readonly repositoryId?: number;
  readonly repository?: string;
  readonly url?: string | null;
  readonly starCount?: number | null;
  readonly createdAt?: number;
}

/** Inserts one `activity` row with plain SQL and returns its id. */
async function addRow(spec: RowSpec = {}): Promise<number> {
  const result = await env.DB.prepare(
    "INSERT INTO activity (kind, sender_id, sender_login, repository_id, repository, repository_url, star_count, created_at) " +
      "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) RETURNING id",
  )
    .bind(
      spec.kind ?? "star",
      spec.senderId ?? 1,
      spec.login ?? "alice",
      spec.repositoryId ?? 2000,
      spec.repository ?? "octo/repo",
      spec.url === undefined ? "https://github.com/octo/repo" : spec.url,
      spec.starCount === undefined ? null : spec.starCount,
      spec.createdAt ?? NOW,
    )
    .first();
  const id = result?.id;
  if (typeof id !== "number") {
    throw new TypeError("The insert returned no id");
  }
  return id;
}

async function allRows(): Promise<Record<string, unknown>[]> {
  const { results } = await env.DB.prepare("SELECT * FROM activity ORDER BY id").all();
  return results;
}

async function ids(): Promise<unknown[]> {
  const { results } = await env.DB.prepare("SELECT id FROM activity ORDER BY id").all();
  return results.map((row) => row.id);
}

describe("ACTIVITY_RETENTION_MS", () => {
  it("ACTIVITY_RETENTION_MS is seven days in milliseconds", () => {
    expect(ACTIVITY_RETENTION_MS, "retention").toBe(7 * 24 * 60 * 60 * 1000);
  });
});

describe("activityInsert", () => {
  it("activityInsert stores a star with its fields and the delivery time", async () => {
    await activityInsert(env.DB, eventWith(), new Date(NOW)).run();

    const rows = await allRows();
    expect(rows, "rows").toHaveLength(1);
    expect(rows[0], "row").toMatchObject({
      kind: "star",
      sender_id: 1_000_002,
      sender_login: "alice",
      repository_id: 2000,
      repository: "octo/repo",
      repository_url: "https://github.com/octo/repo",
      star_count: 5,
      created_at: NOW,
    });
  });

  it("activityInsert stores no star count for a fork even when the event carries one", async () => {
    await activityInsert(env.DB, eventWith({ kind: "fork", starCount: 7 }), new Date(NOW)).run();

    const rows = await allRows();
    expect(rows[0]?.kind, "kind").toBe("fork");
    expect(rows[0]?.star_count, "star count").toBeNull();
  });

  it("activityInsert stores no star count for a star without a known count", async () => {
    await activityInsert(env.DB, eventWith({ starCount: undefined }), new Date(NOW)).run();

    expect((await allRows())[0]?.star_count, "star count").toBeNull();
  });

  it.each([
    { case: "an http URL", url: ["http", "://github.com/octo/repo"].join("") },
    { case: "another host", url: "https://evil.example/octo/repo" },
    { case: "a URL with credentials", url: "https://user:pw@github.com/octo/repo" },
    { case: "the empty text", url: "" },
    { case: "a text that is no URL", url: "octo/repo" },
  ])("activityInsert stores no repository URL for $case", async ({ url }) => {
    await activityInsert(env.DB, eventWith({ repositoryUrl: url }), new Date(NOW)).run();

    expect((await allRows())[0]?.repository_url, "stored URL").toBeNull();
  });

  it("activityInsert cuts a 300-code-point login to 64 and a repository to 140 with an ellipsis", async () => {
    await activityInsert(
      env.DB,
      eventWith({ senderLogin: "a".repeat(300), repository: "o/".concat("r".repeat(298)) }),
      new Date(NOW),
    ).run();

    const row = (await allRows())[0];
    expect(row?.sender_login, "login").toBe(`${"a".repeat(63)}…`);
    expect(row?.repository, "repository").toBe(`o/${"r".repeat(137)}…`);
  });

  it("activityInsert removes directional characters and turns line breaks into spaces", async () => {
    // One backslash in the source: the text holds a real U+202E and a real line feed.
    await activityInsert(
      env.DB,
      eventWith({ senderLogin: "ev‮il\nname", repository: "o/‮r\u0007x" }),
      new Date(NOW),
    ).run();

    const row = (await allRows())[0];
    expect(row?.sender_login, "login").toBe("evil name");
    expect(row?.repository, "repository").toBe("o/r x");
  });

  it("activityInsert keeps markup as plain text, which the rendering escapes", async () => {
    await activityInsert(env.DB, eventWith({ senderLogin: "<b>x</b>&" }), new Date(NOW)).run();

    expect((await allRows())[0]?.sender_login, "login").toBe("<b>x</b>&");
  });

  it("activityInsert gives increasing ids and never reuses the id of a deleted last row", async () => {
    await activityInsert(env.DB, eventWith(), new Date(NOW)).run();
    const first = (await ids())[0];
    await env.DB.prepare("DELETE FROM activity").run();

    await activityInsert(env.DB, eventWith(), new Date(NOW)).run();

    const second = (await ids())[0];
    expect(typeof first === "number" && typeof second === "number" && second > first, "second id above first").toBe(
      true,
    );
  });
});

describe("starRemovalDelete", () => {
  it("starRemovalDelete removes every star of the account on the repository and nothing else", async () => {
    await addRow({ senderId: 7, repositoryId: 2000 });
    await addRow({ senderId: 7, repositoryId: 2000 });
    const otherAccount = await addRow({ senderId: 8, repositoryId: 2000 });
    const otherRepository = await addRow({ senderId: 7, repositoryId: 2001 });
    const fork = await addRow({ kind: "fork", senderId: 7, repositoryId: 2000 });

    await starRemovalDelete(env.DB, { senderId: 7, repositoryId: 2000 }).run();

    expect(await ids(), "remaining ids").toEqual([otherAccount, otherRepository, fork]);
  });

  it("starRemovalDelete leaves the table alone when the account has no star", async () => {
    const kept = await addRow({ senderId: 8 });

    await starRemovalDelete(env.DB, { senderId: 7, repositoryId: 2000 }).run();

    expect(await ids(), "remaining ids").toEqual([kept]);
  });

  it("starRemovalDelete works inside a batch with an insert of the same delivery", async () => {
    await addRow({ senderId: 7 });

    await env.DB.batch([
      activityInsert(env.DB, eventWith({ senderId: 9 }), new Date(NOW)),
      starRemovalDelete(env.DB, { senderId: 7, repositoryId: 2000 }),
    ]);

    const rows = await allRows();
    expect(
      rows.map((row) => row.sender_id),
      "remaining senders",
    ).toEqual([9]);
  });
});

describe("readDigestSummary", () => {
  it("readDigestSummary returns undefined for an empty table", async () => {
    const summary = await readDigestSummary(env.DB, NOT_BEFORE);

    expect(summary, "summary").toBeUndefined();
  });

  it("readDigestSummary returns the largest id and no repositories when only stale rows exist", async () => {
    await addRow({ createdAt: NOW - ACTIVITY_RETENTION_MS - 1 });
    const last = await addRow({ createdAt: NOW - ACTIVITY_RETENTION_MS - 5 });

    const summary = await readDigestSummary(env.DB, NOT_BEFORE);

    expect(summary, "summary").toEqual({ maxId: last, repositories: [], totalRepositories: 0 });
  });

  it("readDigestSummary counts the largest id over stale rows too", async () => {
    await addRow({ senderId: 1 });
    const stale = await addRow({ senderId: 2, createdAt: NOW - ACTIVITY_RETENTION_MS - 1 });

    const summary = await readDigestSummary(env.DB, NOT_BEFORE);

    expect(summary?.maxId, "maxId").toBe(stale);
    expect(summary?.repositories[0]?.stars, "only the fresh star counts").toBe(1);
  });

  it("readDigestSummary summarizes one repository: counts, accounts, names, count and URL of the newest", async () => {
    await addRow({ senderId: 1, login: "alice", starCount: 3 });
    await addRow({ senderId: 2, login: "bob", starCount: 9 });
    await addRow({ kind: "fork", senderId: 3, login: "carol" });
    const last = await addRow({ senderId: 1, login: "alice", starCount: 12 });

    const summary = await readDigestSummary(env.DB, NOT_BEFORE);

    expect(summary, "summary").toEqual({
      maxId: last,
      totalRepositories: 1,
      repositories: [
        {
          repositoryId: 2000,
          repository: "octo/repo",
          repositoryUrl: "https://github.com/octo/repo",
          stars: 3,
          forks: 1,
          starCount: 12,
          accounts: 3,
          names: ["alice", "bob", "carol"],
        },
      ],
    });
  });

  it("readDigestSummary takes the star count of the newest star, not of the newest fork", async () => {
    await addRow({ senderId: 1, starCount: 3 });
    await addRow({ senderId: 2, starCount: 9 });
    await addRow({ kind: "fork", senderId: 3, starCount: 100 });

    const summary = await readDigestSummary(env.DB, NOT_BEFORE);

    expect(summary?.repositories[0]?.starCount, "star count").toBe(9);
  });

  it("readDigestSummary reports no star count for forks only or when the newest star has none", async () => {
    await addRow({ kind: "fork", senderId: 1, repositoryId: 2000, repository: "octo/forks" });
    await addRow({ senderId: 2, repositoryId: 2001, repository: "octo/stars", starCount: 4 });
    await addRow({ senderId: 3, repositoryId: 2001, repository: "octo/stars", starCount: null });

    const summary = await readDigestSummary(env.DB, NOT_BEFORE);

    expect(
      summary?.repositories.map((repository) => [repository.repository, repository.starCount]),
      "star counts",
    ).toEqual([
      ["octo/stars", undefined],
      ["octo/forks", undefined],
    ]);
  });

  it("readDigestSummary takes the name and URL of the newest event of a renamed repository", async () => {
    await addRow({ senderId: 1, repository: "octo/old", url: "https://github.com/octo/old" });
    await addRow({ senderId: 2, repository: "octo/new", url: "https://github.com/octo/new" });

    const summary = await readDigestSummary(env.DB, NOT_BEFORE);

    expect(summary?.repositories).toHaveLength(1);
    expect(summary?.repositories[0]?.repository, "name").toBe("octo/new");
    expect(summary?.repositories[0]?.repositoryUrl, "URL").toBe("https://github.com/octo/new");
  });

  it("readDigestSummary reports an undefined URL when the newest event has none", async () => {
    await addRow({ senderId: 1 });
    await addRow({ senderId: 2, url: null });

    const summary = await readDigestSummary(env.DB, NOT_BEFORE);

    expect(summary?.repositories[0]?.repositoryUrl, "URL").toBeUndefined();
  });

  it("readDigestSummary counts an account once but its stars each", async () => {
    await addRow({ senderId: 1, login: "alice" });
    await addRow({ senderId: 1, login: "alice" });
    await addRow({ kind: "fork", senderId: 1, login: "alice" });

    const summary = await readDigestSummary(env.DB, NOT_BEFORE);

    expect(summary?.repositories[0]).toMatchObject({ stars: 2, forks: 1, accounts: 1, names: ["alice"] });
  });

  it("readDigestSummary lists the first events' accounts in order, at most five, and counts all accounts", async () => {
    for (let sender = 1; sender <= 7; sender += 1) {
      await addRow({ senderId: sender, login: `user${String(sender)}` });
    }
    await addRow({ senderId: 1, login: "user1" });

    const summary = await readDigestSummary(env.DB, NOT_BEFORE);

    expect(DIGEST_MAX_NAMES, "bound").toBe(5);
    expect(summary?.repositories[0]?.accounts, "accounts").toBe(7);
    expect(summary?.repositories[0]?.stars, "stars").toBe(8);
    expect(summary?.repositories[0]?.names, "names").toEqual(["user1", "user2", "user3", "user4", "user5"]);
  });

  it("readDigestSummary orders by stars plus forks, then by name in binary order", async () => {
    await addRow({ senderId: 1, repositoryId: 1, repository: "octo/b" });
    await addRow({ senderId: 1, repositoryId: 2, repository: "octo/a" });
    await addRow({ senderId: 1, repositoryId: 3, repository: "Octo/z" });
    await addRow({ senderId: 1, repositoryId: 4, repository: "octo/big" });
    await addRow({ kind: "fork", senderId: 2, repositoryId: 4, repository: "octo/big" });

    const summary = await readDigestSummary(env.DB, NOT_BEFORE);

    expect(
      summary?.repositories.map((repository) => repository.repository),
      "order",
    ).toEqual(["octo/big", "Octo/z", "octo/a", "octo/b"]);
  });

  it("readDigestSummary returns the ten busiest repositories and the total of all", async () => {
    for (let repository = 1; repository <= 12; repository += 1) {
      for (let sender = 1; sender <= repository; sender += 1) {
        await addRow({
          senderId: sender,
          repositoryId: repository,
          repository: `octo/r${String(repository).padStart(2, "0")}`,
        });
      }
    }

    const summary = await readDigestSummary(env.DB, NOT_BEFORE);

    expect(DIGEST_MAX_REPOSITORIES, "bound").toBe(10);
    expect(summary?.totalRepositories, "total").toBe(12);
    expect(
      summary?.repositories.map((repository) => repository.repository),
      "listed repositories",
    ).toEqual(["12", "11", "10", "09", "08", "07", "06", "05", "04", "03"].map((number) => `octo/r${number}`));
  });

  it("readDigestSummary leaves out rows older than notBefore and keeps a row created exactly at it", async () => {
    await addRow({ senderId: 1, login: "stale", createdAt: NOT_BEFORE.getTime() - 1 });
    await addRow({ senderId: 2, login: "edge", createdAt: NOT_BEFORE.getTime() });
    await addRow({ senderId: 3, login: "fresh", repositoryId: 2001, repository: "octo/other" });
    await addRow({ senderId: 4, login: "gone", repositoryId: 2002, repository: "octo/gone", createdAt: 0 });

    const summary = await readDigestSummary(env.DB, NOT_BEFORE);

    expect(summary?.totalRepositories, "total counts only repositories with fresh rows").toBe(2);
    expect(
      summary?.repositories.map((repository) => [repository.repository, repository.stars, repository.names]),
      "repositories",
    ).toEqual([
      ["octo/other", 1, ["fresh"]],
      ["octo/repo", 1, ["edge"]],
    ]);
  });

  it("readDigestSummary counts 10,000 events exactly in one summary", async () => {
    await env.DB.prepare(
      "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 10000) " +
        "INSERT INTO activity (kind, sender_id, sender_login, repository_id, repository, repository_url, star_count, created_at) " +
        "SELECT CASE WHEN i % 4 = 0 THEN 'fork' ELSE 'star' END, i, 'u' || i, 2000 + (i % 2), 'octo/r' || (i % 2), NULL, i, ?1 FROM n",
    )
      .bind(NOW)
      .run();

    const summary = await readDigestSummary(env.DB, NOT_BEFORE);

    expect(summary?.totalRepositories, "total").toBe(2);
    const counts = summary?.repositories.map((repository) => [
      repository.repository,
      repository.stars,
      repository.forks,
      repository.accounts,
      repository.names.length,
    ]);
    expect(counts, "exact counts").toEqual([
      ["octo/r0", 2500, 2500, 5000, 5],
      ["octo/r1", 5000, 0, 5000, 5],
    ]);
    expect(summary?.repositories[1]?.names, "first accounts of the repository").toEqual(["u1", "u3", "u5", "u7", "u9"]);
    expect(summary?.maxId, "largest id").toBe(10_000);
  });

  it("readDigestSummary rejects when the table is missing", async () => {
    await expect(readDigestSummary(migrationTestDb(), NOT_BEFORE), "read without the table").rejects.toThrow(
      /no such table/i,
    );
  });
});

describe("countedActivityDelete", () => {
  it("countedActivityDelete deletes every row up to the largest id and keeps later rows", async () => {
    await addRow({ senderId: 1 });
    const counted = await addRow({ senderId: 2 });
    const later = await addRow({ senderId: 3 });

    await countedActivityDelete(env.DB, counted).run();

    expect(await ids(), "remaining ids").toEqual([later]);
  });

  it("countedActivityDelete deletes stale rows too", async () => {
    const stale = await addRow({ createdAt: 0 });

    await countedActivityDelete(env.DB, stale).run();

    expect(await ids(), "remaining ids").toEqual([]);
  });
});

describe("oldActivityDelete", () => {
  it("oldActivityDelete deletes rows created before the time and keeps a row created at it", async () => {
    await addRow({ senderId: 1, createdAt: 99 });
    const atCutoff = await addRow({ senderId: 2, createdAt: 100 });
    const later = await addRow({ senderId: 3, createdAt: 101 });

    await oldActivityDelete(env.DB, new Date(100), 1000).run();

    expect(await ids(), "remaining ids").toEqual([atCutoff, later]);
  });

  it("oldActivityDelete deletes at most the limit, oldest first", async () => {
    const newest = await addRow({ senderId: 1, createdAt: 30 });
    const second = await addRow({ senderId: 2, createdAt: 20 });
    await addRow({ senderId: 3, createdAt: 10 });
    await addRow({ senderId: 4, createdAt: 15 });
    const kept = await addRow({ senderId: 5, createdAt: 1000 });

    await oldActivityDelete(env.DB, new Date(500), 2).run();

    expect(await ids(), "remaining ids").toEqual([newest, second, kept]);
  });
});
