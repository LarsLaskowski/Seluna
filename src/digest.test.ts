import { describe, expect, it } from "vitest";
import { DIGEST_MAX_NAMES, DIGEST_MAX_REPOSITORIES, digestNotification } from "./digest";
import type { DigestRepository, DigestSummary } from "./digest";
import { renderTelegramText } from "./message";
import { decodeStoredNotification, encodeStoredNotification, MAX_EXTRA_LINES } from "./notification";

function repositoryWith(changes: Partial<DigestRepository> = {}): DigestRepository {
  return {
    repositoryId: 2000,
    repository: "example-owner/example-repo",
    repositoryUrl: "https://github.com/example-owner/example-repo",
    stars: 1,
    forks: 0,
    starCount: 1234,
    accounts: 1,
    names: ["example-other-user"],
    ...changes,
  };
}

function summaryOf(repositories: readonly DigestRepository[], totalRepositories = repositories.length): DigestSummary {
  return { maxId: 99, repositories, totalRepositories };
}

/** The `count` repositories `o/r00`, `o/r01` and so on, busiest first, each with one star by `alice`. */
function manyRepositories(count: number, changes: Partial<DigestRepository> = {}): DigestRepository[] {
  return Array.from({ length: count }, (_unused, index) =>
    repositoryWith({
      repositoryId: 3000 + index,
      repository: `o/r${String(index).padStart(2, "0")}`,
      repositoryUrl: `https://github.com/o/r${String(index).padStart(2, "0")}`,
      stars: 100 - index,
      starCount: undefined,
      names: ["alice"],
      ...changes,
    }),
  );
}

/** The number of UTF-16 code units of the title, the lines and the line feeds between them. */
function unitsOf(notification: { title: string; lines?: readonly string[] }): number {
  const lines = notification.lines ?? [];
  return notification.title.length + lines.reduce((sum, line) => sum + line.length + 1, 0);
}

describe("digestNotification layout", () => {
  it("digestNotification puts the bold title alone on line 1 and the repository lines in lines (S1)", () => {
    const { notification } = digestNotification(summaryOf([repositoryWith()]), "en");

    expect(notification, "notification").toEqual({
      title: "New stars and forks",
      repository: "",
      number: undefined,
      subject: "",
      context: "",
      lines: ["example-owner/example-repo: +1 ⭐ (now 1,234) · example-other-user"],
    });
    expect(renderTelegramText(notification), "rendered text").toBe(
      "<b>New stars and forks</b>\nexample-owner/example-repo: +1 ⭐ (now 1,234) · example-other-user",
    );
  });

  it("digestNotification writes the German texts with the German digit grouping", () => {
    const { notification } = digestNotification(summaryOf([repositoryWith()]), "de");

    expect(notification.title, "title").toBe("Neue Sterne und Forks");
    expect(notification.lines, "lines").toEqual([
      "example-owner/example-repo: +1 ⭐ (jetzt 1.234) · example-other-user",
    ]);
  });

  it("digestNotification writes the line of the hourly example with 5 names and 'and 46 more' (S4)", () => {
    const summary = summaryOf([
      repositoryWith({
        repository: "a/x",
        repositoryUrl: "https://github.com/a/x",
        stars: 50,
        forks: 2,
        starCount: 1284,
        accounts: 51,
        names: ["u1", "u2", "u3", "u4", "u5"],
      }),
    ]);

    const english = digestNotification(summary, "en").notification;
    const german = digestNotification(summary, "de").notification;

    expect(english.lines, "English lines").toEqual([
      "a/x: +50 ⭐ (now 1,284), +2 forks · u1, u2, u3, u4, u5 and 46 more",
    ]);
    expect(german.lines, "German lines").toEqual([
      "a/x: +50 ⭐ (jetzt 1.284), +2 Forks · u1, u2, u3, u4, u5 und 46 weitere",
    ]);
  });

  it("digestNotification counts the names left out per distinct account, not per event", () => {
    const summary = summaryOf([
      repositoryWith({ stars: 8, forks: 2, accounts: 7, names: ["u1", "u2", "u3", "u4", "u5"], starCount: undefined }),
    ]);

    const { notification } = digestNotification(summary, "en");

    expect(DIGEST_MAX_NAMES, "bound").toBe(5);
    expect(notification.lines?.[0], "line").toBe(
      "example-owner/example-repo: +8 ⭐, +2 forks · u1, u2, u3, u4, u5 and 2 more",
    );
  });

  it.each([
    { case: "as many accounts as names", accounts: 3, names: ["a", "b", "c"], expected: "a, b, c" },
    { case: "one account", accounts: 1, names: ["a"], expected: "a" },
    { case: "exactly five accounts", accounts: 5, names: ["a", "b", "c", "d", "e"], expected: "a, b, c, d, e" },
    { case: "six accounts", accounts: 6, names: ["a", "b", "c", "d", "e"], expected: "a, b, c, d, e and 1 more" },
  ])("digestNotification ends the names for $case with '$expected'", ({ accounts, names, expected }) => {
    const { notification } = digestNotification(
      summaryOf([repositoryWith({ accounts, names, starCount: undefined })]),
      "en",
    );

    expect(notification.lines?.[0], "line").toBe(`example-owner/example-repo: +1 ⭐ · ${expected}`);
  });

  it.each([
    {
      case: "only stars with a known count",
      changes: { stars: 3, forks: 0, starCount: 10 },
      en: "o/r: +3 ⭐ (now 10) · alice",
      de: "o/r: +3 ⭐ (jetzt 10) · alice",
    },
    {
      case: "only stars with an unknown count",
      changes: { stars: 3, forks: 0, starCount: undefined },
      en: "o/r: +3 ⭐ · alice",
      de: "o/r: +3 ⭐ · alice",
    },
    {
      case: "only forks",
      changes: { stars: 0, forks: 2, starCount: undefined },
      en: "o/r: +2 forks · alice",
      de: "o/r: +2 Forks · alice",
    },
    {
      case: "one fork",
      changes: { stars: 0, forks: 1, starCount: undefined },
      en: "o/r: +1 fork · alice",
      de: "o/r: +1 Fork · alice",
    },
    {
      case: "grouped digits",
      changes: { stars: 1200, forks: 3000, starCount: 1_234_567 },
      en: "o/r: +1,200 ⭐ (now 1,234,567), +3,000 forks · alice",
      de: "o/r: +1.200 ⭐ (jetzt 1.234.567), +3.000 Forks · alice",
    },
  ])("digestNotification leaves out an empty part and groups digits for $case", ({ changes, en, de }) => {
    const summary = summaryOf([
      repositoryWith({ repository: "o/r", repositoryUrl: undefined, names: ["alice"], ...changes }),
    ]);

    expect(digestNotification(summary, "en").notification.lines, "English").toEqual([en]);
    expect(digestNotification(summary, "de").notification.lines, "German").toEqual([de]);
  });

  it("digestNotification keeps the order of the summary: busiest first, ties by name (S5)", () => {
    const summary = summaryOf([
      repositoryWith({ repository: "o/big", stars: 9, names: ["a"] }),
      repositoryWith({ repository: "Z/tie", stars: 2, names: ["a"] }),
      repositoryWith({ repository: "a/tie", stars: 2, names: ["a"] }),
      repositoryWith({ repository: "o/small", stars: 1, names: ["a"] }),
    ]);

    const { notification } = digestNotification(summary, "en");

    expect(
      notification.lines?.map((line) => line.split(":")[0]),
      "repositories in order",
    ).toEqual(["o/big", "Z/tie", "a/tie", "o/small"]);
  });
});

describe("digestNotification bounds", () => {
  it("digestNotification lists ten repositories and then 'and N more repositories' for the rest", () => {
    const { notification } = digestNotification(summaryOf(manyRepositories(10), 12), "en");

    expect(DIGEST_MAX_REPOSITORIES, "bound").toBe(10);
    expect(notification.lines, "number of lines").toHaveLength(11);
    expect(notification.lines?.[9], "tenth repository").toBe("o/r09: +91 ⭐ · alice");
    expect(notification.lines?.[10], "last line").toBe("and 2 more repositories");
    expect(notification.lines?.length, "within the stored limit").toBeLessThanOrEqual(MAX_EXTRA_LINES);
  });

  it("digestNotification writes the German last line", () => {
    const { notification } = digestNotification(summaryOf(manyRepositories(10), 25), "de");

    expect(notification.lines?.[10], "last line").toBe("und 15 weitere Repositories");
  });

  it("digestNotification adds no last line when every repository is listed", () => {
    const { notification } = digestNotification(summaryOf(manyRepositories(10), 10), "en");

    expect(notification.lines, "number of lines").toHaveLength(10);
    expect(notification.lines?.at(-1), "last line").toBe("o/r09: +91 ⭐ · alice");
  });

  it("digestNotification keeps a digest of eleven lines of ASCII names within the cap", () => {
    const { notification } = digestNotification(summaryOf(manyRepositories(10), 12), "en");

    expect(notification.lines, "number of lines").toHaveLength(11);
    expect(unitsOf(notification), "units").toBeLessThanOrEqual(4000);
  });

  it("digestNotification cuts a line of 300 astral code points to 256 with an ellipsis", () => {
    const repository = repositoryWith({ repository: "\u{1F600}".repeat(300), repositoryUrl: undefined });

    const { notification } = digestNotification(summaryOf([repository]), "en");

    const line = notification.lines?.[0] ?? "";
    expect(Array.from(line), "code points").toHaveLength(256);
    expect(line.endsWith("…"), "ellipsis").toBe(true);
    expect(line.startsWith("\u{1F600}".repeat(255)), "kept part").toBe(true);
  });

  it("digestNotification cuts a line with very long names at 256 code points", () => {
    const repository = repositoryWith({ names: ["n".repeat(300)] });

    const { notification } = digestNotification(summaryOf([repository]), "en");

    const line = notification.lines?.[0] ?? "";
    expect(Array.from(line), "code points").toHaveLength(256);
    expect(line.endsWith("…"), "ellipsis").toBe(true);
  });

  it("digestNotification drops lines from the end into 'and N more repositories' above 4,000 UTF-16 units", () => {
    const repositories = manyRepositories(10).map((repository, index) => ({
      ...repository,
      repository: `${"\u{1F600}".repeat(299)}${String(index)}`,
    }));

    const { notification } = digestNotification(summaryOf(repositories, 12), "en");

    const lines = notification.lines ?? [];
    expect(lines, "seven repository lines and the last line").toHaveLength(8);
    for (const line of lines.slice(0, 7)) {
      expect(Array.from(line), "code points of a repository line").toHaveLength(256);
    }
    expect(lines[7], "last line counts the dropped and the unlisted repositories").toBe("and 5 more repositories");
    expect(unitsOf(notification), "units of title, lines and line feeds").toBeLessThanOrEqual(4000);
    expect(renderTelegramText(notification).length, "rendered units").toBeLessThanOrEqual(4096);
  });

  it("digestNotification keeps as many lines as fit the 4,000 units", () => {
    const repositories = manyRepositories(10).map((repository, index) => ({
      ...repository,
      repository: `${"\u{1F600}".repeat(299)}${String(index)}`,
    }));

    const { notification } = digestNotification(summaryOf(repositories, 10), "en");

    expect(notification.lines, "seven repository lines and the last line").toHaveLength(8);
    expect(notification.lines?.[7], "last line").toBe("and 3 more repositories");
    expect(unitsOf(notification) + 512, "one more line of 256 astral code points would exceed the cap").toBeGreaterThan(
      4000,
    );
  });
});

describe("digestNotification button", () => {
  it("digestNotification gives the button of the one repository", () => {
    const { buttonUrl } = digestNotification(summaryOf([repositoryWith()]), "en");

    expect(buttonUrl, "button").toBe("https://github.com/example-owner/example-repo");
  });

  it.each([
    { case: "no URL", repositoryUrl: undefined },
    { case: "a URL buttonUrl rejects", repositoryUrl: "https://evil.example/o/r" },
  ])("digestNotification gives no button for one repository with $case", ({ repositoryUrl }) => {
    const { buttonUrl } = digestNotification(summaryOf([repositoryWith({ repositoryUrl })]), "en");

    expect(buttonUrl, "button").toBeUndefined();
  });

  it("digestNotification gives no button for several repositories", () => {
    const { buttonUrl } = digestNotification(summaryOf(manyRepositories(2)), "en");

    expect(buttonUrl, "button").toBeUndefined();
  });

  it("digestNotification gives no button for one listed repository when more exist", () => {
    const { buttonUrl } = digestNotification(summaryOf(manyRepositories(1), 3), "en");

    expect(buttonUrl, "button").toBeUndefined();
  });
});

describe("digestNotification with hostile text", () => {
  it("digestNotification removes directional characters and turns control characters into spaces", () => {
    // One backslash in the source: the texts hold the real characters.
    const repository = repositoryWith({ repository: "o/‮r\nx", names: ["al‮ice", "b\u0000ob"], accounts: 2 });

    const { notification } = digestNotification(summaryOf([repository]), "en");

    expect(notification.lines, "lines").toEqual(["o/r x: +1 ⭐ (now 1,234) · alice, b ob"]);
  });

  it("digestNotification passes markup on as text and the rendering escapes it", () => {
    const repository = repositoryWith({ repository: "<i>o</i>/r&", names: ["<b>x</b>"], accounts: 1 });

    const { notification } = digestNotification(summaryOf([repository]), "en");

    expect(notification.lines?.[0], "stored line").toBe("<i>o</i>/r&: +1 ⭐ (now 1,234) · <b>x</b>");
    expect(renderTelegramText(notification), "rendered text").toBe(
      "<b>New stars and forks</b>\n&lt;i&gt;o&lt;/i&gt;/r&amp;: +1 ⭐ (now 1,234) · &lt;b&gt;x&lt;/b&gt;",
    );
  });

  it("digestNotification gives a stored form that decodes to the same notification", () => {
    const { notification } = digestNotification(summaryOf(manyRepositories(10), 12), "de");

    const decoded = decodeStoredNotification(encodeStoredNotification(notification));

    expect(decoded, "round trip").toEqual(notification);
  });
});
