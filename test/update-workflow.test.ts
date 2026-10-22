/// <reference types="node" />
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  commitToCopy,
  extractUpdateScript,
  commitUpstream,
  createCopy,
  createSandbox,
  originCommit,
  readOriginFile,
  readOriginMode,
  readRepositoryFile,
  readWorkflowText,
  removeSandbox,
  runUpdate,
  TEST_TOKEN,
} from "./update-workflow";
import type { CopyKind, FileTree, ReleaseAnswer, RunOptions, RunResult, Sandbox } from "./update-workflow";

// Messages: the fixed texts of the spec (E1-E16, S2, S3, S6, S7); the reasons of E2 are the plan's.
const updated = (from: string, to: string): string => `Updated Seluna from ${from} to ${to}.`;
const upToDate = (release: string): string => `Seluna is already on the latest release ${release}; nothing to update.`;
const ORIGINAL_REPOSITORY = "This is the original repository LarsLaskowski/Seluna; it is not updated by this workflow.";
const conflictOf = (release: string, files: string): string =>
  `The update to ${release} conflicts with changes in your copy: ${files}. Nothing was changed. See docs/update.md, "Conflicts".`;
const couldNotRead = (reason: string): string =>
  `Could not read the latest Seluna release: ${reason}. Nothing was changed; run the workflow again later.`;
const NO_USABLE_TAG = "The latest Seluna release has no usable version tag. Nothing was changed.";
const notComparable = (release: string): string =>
  `Your copy's version cannot be compared with the latest release ${release}. Nothing was changed. See docs/update.md.`;
const newMajor = (release: string, copy: string): string =>
  `Release ${release} is a new major version (copy on ${copy}). Read its release notes and docs/update.md, then run the workflow again with "Allow a new major version" checked.`;
const MAIN_CHANGED = "main of your copy changed during the update. Nothing was changed; run the workflow again.";
const WRONG_BRANCH = "Start the update on the main branch.";
const PUSH_REFUSED =
  'GitHub refused the push: the workflow may not write to this repository. See docs/update.md, "Permissions".';
const UNEXPECTED_ERROR = "The update stopped because of an unexpected error. Nothing was changed.";
const UNKNOWN_BASE =
  'The update cannot tell which Seluna version your copy was built from. Nothing was changed. See docs/update.md, "Unknown base".';
const UNUSUAL_NAME = "(a file with an unusual name)";
const workflowLine = (files: readonly string[]): string =>
  `The release changed these workflow files, which your copy keeps as they are: ${files.join(", ")}. See docs/update.md, "Workflow files".`;

// Paths of the sandbox repositories.
const PACKAGE_JSON = "package.json";
const WRANGLER = "wrangler.jsonc";
const README = "README.md";
const INDEX = "src/index.ts";
const GUIDE = "docs/guide.md";
const DOC_A = "docs/a.md";
const DOC_B = "docs/b.md";
const MIGRATION = "migrations/0002_add.sql";
const CODEQL = ".github/workflows/codeql.yml";
const NEW_WORKFLOW = ".github/workflows/new.yml";
const LOCK = "package-lock.json";
const OLD_WORKFLOW = ".github/workflows/old.yml";
const UPDATE_WORKFLOW = ".github/workflows/update.yml";
const OWN_WORKFLOW = ".github/workflows/mine.yml";

const FROM = "0.4.0";
const TO = "0.5.0";
const TAG_FROM = "v0.4.0";
const TAG_TO = "v0.5.0";
const PLANTED_MARKER = "PLANTED-MARKER-7f3a";

/** Twelve lines of text; `changes` replaces lines by their number (1-based). */
function numbered(prefix: string, changes: Readonly<Record<number, string>> = {}): string {
  const lines = Array.from({ length: 12 }, (_, index) => changes[index + 1] ?? `${prefix} line ${String(index + 1)}`);
  return `${lines.join("\n")}\n`;
}

/** The `name` line is directly above the `version` line, as in the repository's `package.json`. */
function packageText(version: string, name = "seluna"): string {
  return `{\n  "name": "${name}",\n  "version": "${version}",\n  "private": true\n}\n`;
}

/** A lock file with the package name and version at the top and in the root package. */
function lockText(version: string): string {
  return [
    "{",
    '  "name": "seluna",',
    `  "version": "${version}",`,
    '  "lockfileVersion": 3,',
    '  "packages": {',
    '    "": {',
    '      "name": "seluna",',
    `      "version": "${version}"`,
    "    }",
    "  }",
    "}",
    "",
  ].join("\n");
}

interface WranglerParts {
  readonly name?: string;
  readonly compatibilityDate?: string;
  readonly databaseName?: string;
  readonly databaseId?: string;
}

/**
 * A `wrangler.jsonc` with the lines the button edits (`name`, `database_name`) and `compatibility_date`; the button
 * appends `database_id` to the `migrations_dir` line.
 */
function wranglerText(parts: WranglerParts = {}): string {
  const migrations =
    parts.databaseId === undefined
      ? ['      "migrations_dir": "migrations"']
      : ['      "migrations_dir": "migrations",', `      "database_id": "${parts.databaseId}"`];
  return [
    "{",
    `  "name": "${parts.name ?? "seluna"}",`,
    '  "main": "src/index.ts",',
    `  "compatibility_date": "${parts.compatibilityDate ?? "2026-01-01"}",`,
    '  "compatibility_flags": ["nodejs_compat"],',
    '  "observability": { "enabled": true },',
    '  "d1_databases": [',
    "    {",
    '      "binding": "DB",',
    `      "database_name": "${parts.databaseName ?? "seluna"}",`,
    ...migrations,
    "    }",
    "  ]",
    "}",
    "",
  ].join("\n");
}

/** What the button writes (values anonymized from a real copy): the names and the generated `database_id`. */
const BUTTON_NAME = "my-seluna";
const BUTTON_PARTS: WranglerParts = {
  name: BUTTON_NAME,
  databaseName: "my_seluna_db",
  databaseId: "6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f",
};

/** The name edits of the button: package name and Wrangler names; `package-lock.json` stays as it is. */
function nameEdits(version: string): FileTree {
  return { [PACKAGE_JSON]: packageText(version, BUTTON_NAME), [WRANGLER]: wranglerText(BUTTON_PARTS) };
}

/** A copy as the button makes it: the name edits and no workflow files (the sample's `.github/workflows` is missing). */
function buttonEdits(version: string): FileTree {
  return { ...nameEdits(version), [CODEQL]: null, [UPDATE_WORKFLOW]: null, [OLD_WORKFLOW]: null };
}

/** The files of the release `version` (the whole tree of the first upstream commit). */
function baseFiles(version: string): FileTree {
  return {
    [PACKAGE_JSON]: packageText(version),
    [LOCK]: lockText(version),
    [WRANGLER]: wranglerText(),
    [README]: numbered("readme"),
    [INDEX]: numbered("index"),
    [GUIDE]: numbered("guide"),
    [DOC_A]: numbered("doc-a"),
    [DOC_B]: numbered("doc-b"),
    "migrations/0001_init.sql": numbered("init"),
    [CODEQL]: numbered("codeql"),
    [UPDATE_WORKFLOW]: numbered("update"),
    [OLD_WORKFLOW]: numbered("old"),
  };
}

/** What a release `version` changes against the previous one, apart from workflow files. */
function releaseChanges(version: string): FileTree {
  return {
    [PACKAGE_JSON]: packageText(version),
    [LOCK]: lockText(version),
    [WRANGLER]: wranglerText({ compatibilityDate: "2026-03-01" }),
    [README]: numbered("readme", { 2: "release note" }),
    [INDEX]: numbered("index", { 3: "release change" }),
    [MIGRATION]: numbered("add"),
  };
}

interface Scenario {
  readonly kind?: CopyKind;
  readonly from?: string;
  readonly to?: string;
  /** Added to the first upstream commit. */
  readonly baseExtra?: FileTree;
  /** Overrides the default changes of the release. */
  readonly release?: FileTree;
  /** The button's edits of the first commit (default `buttonEdits(from)`). */
  readonly buttonEdits?: FileTree;
  /** One commit of the owner on top of the copy. */
  readonly local?: FileTree;
}

/** Upstream `from` (tagged) and `to` (tagged), and a copy built from `from`; the copy's head is the start commit. */
function arrange(sandbox: Sandbox, scenario: Scenario = {}): void {
  const from = scenario.from ?? FROM;
  const to = scenario.to ?? TO;
  const base = commitUpstream(sandbox, { ...baseFiles(from), ...scenario.baseExtra }, `v${from}`);
  commitUpstream(sandbox, { ...releaseChanges(to), ...scenario.release }, `v${to}`);
  createCopy(sandbox, scenario.kind ?? "button", base, scenario.buttonEdits ?? buttonEdits(from));
  if (scenario.local !== undefined) {
    commitToCopy(sandbox, scenario.local, "Local change");
  }
}

function update(sandbox: Sandbox, extra: Partial<RunOptions> = {}, tag = TAG_TO): RunResult {
  return runUpdate(sandbox, { release: { kind: "release", tag }, ...extra });
}

function expectGreen(result: RunResult, message: string): void {
  expect(result.exitCode, "exit code of a green run").toBe(0);
  expect(result.summary.trimEnd(), "summary of the run").toBe(message);
}

function expectRed(result: RunResult, message: string): void {
  expect(result.exitCode, "exit code of a red run").toBe(1);
  expect(result.stdout.split("\n"), "the error annotation").toContain(`::error::${message}`);
  expect(result.summary.trimEnd(), "summary of the run").toBe(message);
  expect(result.originMainAfter, "main of the copy").toBe(result.originMainBefore);
}

function outputOf(result: RunResult): string {
  return `${result.stdout}\n${result.stderr}\n${result.summary}`;
}

describe("update.yml", { timeout: 20_000 }, () => {
  let sandbox: Sandbox;

  beforeEach(() => {
    sandbox = createSandbox();
  });

  afterEach(() => {
    removeSandbox(sandbox);
  });

  describe("AC1: updates a copy to the latest release", () => {
    const LOCAL_README = { [README]: numbered("readme", { 9: "local note" }) };

    it("ends green with the summary Updated Seluna from vX to vY", () => {
      arrange(sandbox);

      const result = update(sandbox);

      expectGreen(result, updated(TAG_FROM, TAG_TO));
    });

    it("pushes one new commit whose parent is the start commit and whose trailer names the release", () => {
      arrange(sandbox);

      const result = update(sandbox);

      const commit = originCommit(sandbox, "refs/heads/main");
      expect(commit.parents, "parent of the pushed commit").toEqual([result.originMainBefore]);
      expect(commit.message, "message of the pushed commit").toBe(
        `Update Seluna to ${TAG_TO}\n\nSeluna-Release: ${TAG_TO}`,
      );
    });

    it("leaves package.json at the version of the release", () => {
      arrange(sandbox);

      update(sandbox);

      expect(readOriginFile(sandbox, PACKAGE_JSON), "package.json of the copy").toBe(packageText(TO, BUTTON_NAME));
    });

    it("leaves package-lock.json with the version lines of the release", () => {
      arrange(sandbox);

      update(sandbox);

      expect(readOriginFile(sandbox, LOCK), "package-lock.json of the copy").toBe(lockText(TO));
    });

    it("applies the changes of the release to files the copy did not change", () => {
      arrange(sandbox);

      update(sandbox);

      expect(readOriginFile(sandbox, INDEX), "src/index.ts of the copy").toBe(releaseChanges(TO)[INDEX]);
      expect(readOriginFile(sandbox, MIGRATION), "the migration the release adds").toBe(releaseChanges(TO)[MIGRATION]);
    });

    it("keeps a local change in another line of a file the release changes", () => {
      arrange(sandbox, { local: LOCAL_README });

      update(sandbox);

      expect(readOriginFile(sandbox, README), "README.md of the copy").toBe(
        numbered("readme", { 2: "release note", 9: "local note" }),
      );
    });

    it("keeps the button's database_id and renamed names in wrangler.jsonc while the release changes compatibility_date", () => {
      arrange(sandbox);

      update(sandbox);

      expect(readOriginFile(sandbox, WRANGLER), "wrangler.jsonc of the copy").toBe(
        wranglerText({ ...BUTTON_PARTS, compatibilityDate: "2026-03-01" }),
      );
    });

    it("applies the header of the token to the copy's URL and not to the upstream URL", () => {
      arrange(sandbox);
      const encoded = Buffer.from(`x-access-token:${TEST_TOKEN}`).toString("base64");
      const header = `AUTHORIZATION: basic ${encoded}`;

      const result = update(sandbox, { recordHeaderMatch: true });

      expect(result.headerMatches[`https://github.com/${sandbox.copyName}.git/info/refs`], "header for the copy").toBe(
        header,
      );
      expect(
        result.headerMatches["https://github.com/LarsLaskowski/Seluna.git/info/refs"],
        "header for the upstream repository",
      ).toBe("");
    });

    it("prints one add-mask line with the base64 value of the header", () => {
      arrange(sandbox);
      const encoded = Buffer.from(`x-access-token:${TEST_TOKEN}`).toString("base64");

      const result = update(sandbox);

      expect(result.stdout.split("::add-mask::").length - 1, "number of add-mask lines").toBe(1);
      expect(result.stdout.split("\n"), "the masked value").toContain(`::add-mask::${encoded}`);
    });

    it("prints the add-mask line before the clone starts", () => {
      arrange(sandbox);

      const result = update(sandbox, { recordHeaderMatch: true });

      expect(result.stdoutAtClone, "stdout when the clone started").toContain("::add-mask::");
    });
  });

  describe("AC1: names and file modes", () => {
    const RUN_SCRIPT = "scripts/run.sh";
    const SCRIPT_TEXT = "#!/bin/sh\necho hi\n";

    /** A `package.json` whose first name line is the package name and a second, name-like line sits below it. */
    function packageWithNested(version: string, name: string): string {
      return `{\n  "name": "${name}",\n  "version": "${version}",\n  "config": {\n    "name": "selXuna"\n  }\n}\n`;
    }

    it("replaces the upstream name only as a literal string and leaves a name-like line unchanged", () => {
      arrange(sandbox, {
        baseExtra: { [PACKAGE_JSON]: packageWithNested(FROM, "sel.una") },
        release: { [PACKAGE_JSON]: packageWithNested(TO, "sel.una") },
        buttonEdits: { ...buttonEdits(FROM), [PACKAGE_JSON]: packageWithNested(FROM, BUTTON_NAME) },
      });

      const result = update(sandbox);

      expectGreen(result, updated(TAG_FROM, TAG_TO));
      expect(readOriginFile(sandbox, PACKAGE_JSON), "package.json of the copy").toBe(
        packageWithNested(TO, BUTTON_NAME),
      );
    });

    it("changes in the update commit only the files the release changed", () => {
      arrange(sandbox);

      update(sandbox);

      expect(originCommit(sandbox, "refs/heads/main").changedPaths, "paths changed by the pushed commit").toEqual([
        README,
        MIGRATION,
        LOCK,
        PACKAGE_JSON,
        INDEX,
        WRANGLER,
      ]);
    });

    it("does not rewrite package.json, package-lock.json or wrangler.jsonc when the release does not change them", () => {
      arrange(sandbox, {
        release: {
          [PACKAGE_JSON]: packageText(FROM),
          [LOCK]: lockText(FROM),
          [WRANGLER]: wranglerText(),
          [INDEX]: numbered("index"),
          [MIGRATION]: null,
        },
      });

      update(sandbox);

      expect(originCommit(sandbox, "refs/heads/main").changedPaths, "paths changed by the pushed commit").toEqual([
        README,
      ]);
    });

    it("keeps the mode of an executable file the release did not touch and of one it changed", () => {
      const changed = "scripts/changed.sh";
      arrange(sandbox, {
        baseExtra: { [RUN_SCRIPT]: SCRIPT_TEXT, [changed]: SCRIPT_TEXT },
        release: { [changed]: `${SCRIPT_TEXT}echo more\n` },
      });

      update(sandbox);

      expect(readOriginMode(sandbox, RUN_SCRIPT), "mode of the untouched script").toBe("100755");
      expect(readOriginMode(sandbox, changed), "mode of the changed script").toBe("100755");
      expect(readOriginFile(sandbox, changed), "content of the changed script").toBe(`${SCRIPT_TEXT}echo more\n`);
    });
  });

  describe("AC8: failures inside substitutions and large files", () => {
    /** A lock file of about 300 KB with the name lines near the top, as in a real one. */
    function largeLockText(version: string): string {
      const entries = Array.from({ length: 2500 }, (_, index) => {
        const name = `node_modules/package-${String(index)}`;
        return `    "${name}": { "version": "1.0.0", "resolved": "https://registry.example.invalid/${name}.tgz" }`;
      });
      return lockText(version).replace('    "": {', `${entries.join(",\n")},\n    "": {`);
    }

    it("updates a copy whose package-lock.json is larger than a pipe buffer although awk stops reading early", () => {
      expect(largeLockText(FROM).length, "size of the lock file").toBeGreaterThan(200_000);
      arrange(sandbox, { baseExtra: { [LOCK]: largeLockText(FROM) }, release: { [LOCK]: largeLockText(TO) } });

      const result = update(sandbox, { awkStopsEarly: true });

      expectGreen(result, updated(TAG_FROM, TAG_TO));
      expect(readOriginFile(sandbox, LOCK), "package-lock.json of the copy").toBe(largeLockText(TO));
    });

    it.each(["write-tree", "commit-tree", "hash-object", "ls-tree", "rev-list", "read-tree"])(
      "reports one unexpected error without the text of the failing %s",
      (command) => {
        arrange(sandbox);

        const result = update(sandbox, { failingGitCommand: command });

        expectRed(result, UNEXPECTED_ERROR);
        expect(
          result.stdout.split("\n").filter((line) => line === `::error::${UNEXPECTED_ERROR}`),
          "error annotations on stdout",
        ).toHaveLength(1);
        expect(result.summary.split(UNEXPECTED_ERROR).length - 1, "messages in the summary").toBe(1);
        expect(result.stdout, "text of the failing command on stdout").not.toContain("simulated failure");
        expect(result.stderr, "text of the failing command on stderr").not.toContain("simulated failure");
        expect(result.stdout.split("::add-mask::").length - 1, "number of add-mask lines").toBe(1);
      },
    );
  });

  describe("AC1: the token is never printed", () => {
    it.each<readonly [string, Partial<RunOptions>, string]>([
      ["a successful update", {}, TAG_TO],
      ["a failure after the clone (refused push)", { refusePush: true }, TAG_TO],
      ["a failure before the clone (unusable tag)", {}, "v1.2"],
    ])("prints neither the token nor its base64 form outside the add-mask line for %s", (_label, extra, tag) => {
      arrange(sandbox);
      const encoded = Buffer.from(`x-access-token:${TEST_TOKEN}`).toString("base64");

      const result = update(sandbox, extra, tag);

      const unmasked = [
        ...result.stdout.split("\n").filter((line) => !line.startsWith("::add-mask::")),
        result.stderr,
        result.summary,
      ].join("\n");
      expect(unmasked, "the token in the output").not.toContain(TEST_TOKEN);
      expect(unmasked, "the base64 header value in the output").not.toContain(encoded);
      expect(result.stdout.replace(`::add-mask::${encoded}`, ""), "the token next to the mask").not.toContain(
        TEST_TOKEN,
      );
    });
  });

  describe("AC2: a copy on the latest release", () => {
    it("ends green with the already-on-latest summary and leaves origin unchanged", () => {
      arrange(sandbox);

      const result = update(sandbox, {}, TAG_FROM);

      expectGreen(result, upToDate(TAG_FROM));
      expect(result.originMainAfter, "main of the copy").toBe(result.originMainBefore);
    });

    it("ends the same way for a second run after a first update", () => {
      arrange(sandbox);
      update(sandbox);

      const second = update(sandbox);

      expectGreen(second, upToDate(TAG_TO));
      expect(second.originMainAfter, "main of the copy").toBe(second.originMainBefore);
    });

    it("declares the concurrency group seluna-update without cancelling a run in progress", () => {
      const workflow = readWorkflowText();

      expect(workflow, "the concurrency block").toMatch(
        /^concurrency:\n {2}group: seluna-update\n {2}cancel-in-progress: false$/m,
      );
    });

    it("clones the main branch of the copy", () => {
      const script = readWorkflowText();

      expect(script, "the clone of main").toMatch(/git clone[\s\S]*?--branch main/);
    });
  });

  describe("AC3: the original repository", () => {
    it.each(["LarsLaskowski/Seluna", "larslaskowski/SELUNA"])(
      "%s ends green with the original-repository summary, reads no release and pushes nothing",
      (repository) => {
        arrange(sandbox);

        const result = update(sandbox, { repository });

        expectGreen(result, ORIGINAL_REPOSITORY);
        expect(result.curlCalls, "calls of curl").toBe(0);
        expect(result.originMainAfter, "main of the copy").toBe(result.originMainBefore);
      },
    );
  });

  describe("AC4: conflicts", () => {
    const sameLine = { [GUIDE]: numbered("guide", { 5: "release line" }) };

    it.each([
      ["the same line", 5],
      ["the line after", 6],
      ["the line before", 4],
    ] as const)("fails with the conflict message when the copy changed %s", (_label, line) => {
      arrange(sandbox, { release: sameLine, local: { [GUIDE]: numbered("guide", { [line]: "local line" }) } });

      const result = update(sandbox);

      expectRed(result, conflictOf(TAG_TO, GUIDE));
    });

    it("names every conflicting file once, sorted", () => {
      arrange(sandbox, {
        release: { [DOC_B]: numbered("doc-b", { 5: "release b" }), [DOC_A]: numbered("doc-a", { 5: "release a" }) },
        local: { [DOC_B]: numbered("doc-b", { 5: "local b" }), [DOC_A]: numbered("doc-a", { 5: "local a" }) },
      });

      const result = update(sandbox);

      expectRed(result, conflictOf(TAG_TO, `${DOC_A}, ${DOC_B}`));
    });

    it("fails when the release deletes a file the copy changed", () => {
      arrange(sandbox, { release: { [DOC_A]: null }, local: { [DOC_A]: numbered("doc-a", { 5: "local a" }) } });

      const result = update(sandbox);

      expectRed(result, conflictOf(TAG_TO, DOC_A));
    });

    it.each([
      ["without an edit of the new file", numbered("doc-a")],
      ["with an edit of the new file", numbered("doc-a", { 10: "release edit" })],
    ])("names the old path when the release renames a file the copy changed %s", (_label, renamed) => {
      arrange(sandbox, {
        release: { [DOC_A]: null, "docs/renamed.md": renamed },
        local: { [DOC_A]: numbered("doc-a", { 3: "local a" }) },
      });

      const result = update(sandbox);

      expectRed(result, conflictOf(TAG_TO, DOC_A));
    });

    it("takes the old path of a rename literally and reports no conflict for a file its glob would match", () => {
      const globbed = "docs/a*.md";
      arrange(sandbox, {
        baseExtra: { [globbed]: numbered("globbed") },
        release: { [globbed]: null, "docs/renamed.md": numbered("globbed") },
        local: { [DOC_A]: numbered("doc-a", { 3: "local" }) },
      });

      const result = update(sandbox);

      expectGreen(result, updated(TAG_FROM, TAG_TO));
      expect(readOriginFile(sandbox, DOC_A), "docs/a.md of the copy").toBe(numbered("doc-a", { 3: "local" }));
    });

    it("prints a file name outside the allow-list as a file with an unusual name", () => {
      const spaced = "docs/my file.md";
      arrange(sandbox, {
        baseExtra: { [spaced]: numbered("spaced") },
        release: { [spaced]: numbered("spaced", { 5: "release" }) },
        local: { [spaced]: numbered("spaced", { 5: "local" }) },
      });

      const result = update(sandbox);

      expectRed(result, conflictOf(TAG_TO, UNUSUAL_NAME));
    });
  });

  describe("AC5: the latest release cannot be used", () => {
    const BIG_BODY = JSON.stringify({ tag_name: TAG_TO, padding: "x".repeat(1_048_577) });

    it.each<readonly [string, ReleaseAnswer, string]>([
      ["no answer", { kind: "no-answer" }, "GitHub did not answer"],
      ["status 404", { kind: "status", status: 404 }, "there is no latest release"],
      ["status 500", { kind: "status", status: 500 }, "GitHub answered with an error"],
      ["a body over 1 MiB", { kind: "body", body: BIG_BODY }, "GitHub did not answer"],
      ["invalid JSON", { kind: "body", body: `${PLANTED_MARKER} is not json` }, "the answer could not be read"],
      [
        "tag_name missing",
        { kind: "body", body: JSON.stringify({ name: PLANTED_MARKER }) },
        "the answer could not be read",
      ],
      [
        "tag_name a number",
        { kind: "body", body: JSON.stringify({ tag_name: 5, body: PLANTED_MARKER }) },
        "the answer could not be read",
      ],
    ])("fails with the message of E2 for %s and prints nothing of the answer", (_label, release, reason) => {
      arrange(sandbox);

      const result = runUpdate(sandbox, { release });

      expectRed(result, couldNotRead(reason));
      expect(outputOf(result), "text of the answer in the output").not.toContain(PLANTED_MARKER);
    });

    it.each([
      ["v1.2"],
      ["v01.2.3"],
      ["v1.2.3-rc.1"],
      ["1.2.3"],
      ["v1.2.1234567890"],
      ["v1.2.3\nv9.9.9"],
      ["v1.2.3\n"],
      [`v1.2.3-${PLANTED_MARKER}`],
    ])("fails with the message of E3 for the tag %j and prints no part of it", (tag) => {
      arrange(sandbox);

      const result = update(sandbox, {}, tag);

      expectRed(result, NO_USABLE_TAG);
      expect(outputOf(result), "the tag in the output").not.toContain(tag.trim());
    });

    it("fails with the message of E3 for a valid tag that upstream lacks", () => {
      arrange(sandbox);

      const result = update(sandbox, {}, "v0.9.0");

      expectRed(result, NO_USABLE_TAG);
    });
  });

  describe("AC6: the version of the copy cannot be compared", () => {
    it.each([
      ["no version", '{\n  "name": "seluna-marker-q7"\n}\n', "marker-q7"],
      ["the version 1.2", packageText("1.2"), "1.2"],
      ["a version newer than the release", packageText("0.6.0"), "0.6.0"],
      ["a version with a trailing newline", '{\n  "version": "0.4.0\\n"\n}\n', "0.4.0"],
    ])("fails with the message of E4 for %s and does not print the version", (_label, text, printed) => {
      arrange(sandbox, { local: { [PACKAGE_JSON]: text } });

      const result = update(sandbox);

      expectRed(result, notComparable(TAG_TO));
      expect(outputOf(result), "the version of the copy in the output").not.toContain(printed);
    });
  });

  describe("AC7: a new major version", () => {
    it("fails with the message of S6 for 1.4.0 to 2.0.0 without the input", () => {
      arrange(sandbox, { from: "1.4.0", to: "2.0.0" });

      const result = update(sandbox, {}, "v2.0.0");

      expectRed(result, newMajor("v2.0.0", "v1.4.0"));
    });

    it("updates 1.4.0 to 2.0.0 when started with Allow a new major version", () => {
      arrange(sandbox, { from: "1.4.0", to: "2.0.0" });

      const result = update(sandbox, { allowMajor: true }, "v2.0.0");

      expectGreen(result, updated("v1.4.0", "v2.0.0"));
    });

    it("updates 0.4.0 to 1.0.0 without the input", () => {
      arrange(sandbox, { to: "1.0.0" });

      const result = update(sandbox, {}, "v1.0.0");

      expectGreen(result, updated(TAG_FROM, "v1.0.0"));
    });
  });

  describe("AC8: no overwriting, one run at a time", () => {
    it("fails with the message of E5 when main moves during the run and keeps the commit that moved it", () => {
      arrange(sandbox);

      const result = update(sandbox, { moveMainDuringRun: true });

      expect(result.exitCode, "exit code").toBe(1);
      expect(result.stdout.split("\n"), "the error annotation").toContain(`::error::${MAIN_CHANGED}`);
      expect(result.summary.trimEnd(), "summary of the run").toBe(MAIN_CHANGED);
      expect(result.originMainAfter, "main moved by the owner").not.toBe(result.originMainBefore);
      expect(originCommit(sandbox, "refs/heads/main").message, "the commit on main").toBe(
        "Owner commit during the update",
      );
    });

    it("fails with the message of E7 for a run started on another branch", () => {
      arrange(sandbox);

      const result = update(sandbox, { ref: "refs/heads/other" });

      expectRed(result, WRONG_BRANCH);
    });

    it("fails with the message of E8 when GitHub refuses the push", () => {
      arrange(sandbox);

      const result = update(sandbox, { refusePush: true });

      expectRed(result, PUSH_REFUSED);
    });

    it("never forces the push: the script has no --force, no -f option and no + refspec on a push", () => {
      const script = extractUpdateScript(readWorkflowText());
      const pushes = script.split("\n").filter((line) => /\bgit push\b/.test(line));

      expect(script, "the script").not.toMatch(/--force|--mirror/);
      expect(pushes.length, "lines that push").toBeGreaterThan(0);
      for (const line of pushes) {
        expect(line, "a push line").not.toMatch(/\s-[a-zA-Z]*f|\s\+/);
      }
    });

    it("fails with the message of E16 and pushes nothing when the commit would change a workflow file", () => {
      arrange(sandbox);

      const result = update(sandbox, { plantWorkflowChange: true });

      expectRed(result, UNEXPECTED_ERROR);
    });

    it("fails with the message of E16 when a Git command fails unexpectedly", () => {
      arrange(sandbox);

      const result = update(sandbox, { failingGitCommand: "merge-tree" });

      expectRed(result, UNEXPECTED_ERROR);
    });
  });

  describe("AC9: workflow files", () => {
    const RELEASE_WORKFLOWS: FileTree = {
      [CODEQL]: numbered("codeql", { 4: "release v2" }),
      [UPDATE_WORKFLOW]: numbered("update", { 4: "release v2" }),
      [OLD_WORKFLOW]: null,
      [NEW_WORKFLOW]: numbered("new"),
    };
    /** The copy keeps the workflow files of the base (a fork, or an owner who added them). */
    const WITH_WORKFLOWS = { buttonEdits: nameEdits(FROM) };
    const THREE = [CODEQL, OLD_WORKFLOW, UPDATE_WORKFLOW];

    it("applies the release without changing any file under .github/workflows", () => {
      arrange(sandbox, { ...WITH_WORKFLOWS, release: RELEASE_WORKFLOWS });

      update(sandbox);

      expect(readOriginFile(sandbox, INDEX), "src/index.ts, applied from the release").toBe(releaseChanges(TO)[INDEX]);
      expect(readOriginFile(sandbox, CODEQL), "codeql.yml").toBe(numbered("codeql"));
      expect(readOriginFile(sandbox, UPDATE_WORKFLOW), "update.yml").toBe(numbered("update"));
      expect(readOriginFile(sandbox, OLD_WORKFLOW), "old.yml").toBe(numbered("old"));
      expect(readOriginFile(sandbox, NEW_WORKFLOW), "new.yml").toBeNull();
    });

    it("pushes a commit that changes no path under .github/workflows", () => {
      arrange(sandbox, { ...WITH_WORKFLOWS, release: RELEASE_WORKFLOWS });

      update(sandbox);

      const paths = originCommit(sandbox, "refs/heads/main").changedPaths;
      expect(paths, "paths changed by the pushed commit").toContain(README);
      expect(
        paths.filter((path) => path.startsWith(".github/workflows/")),
        "workflow paths changed by the pushed commit",
      ).toEqual([]);
    });

    it("lists the copy's workflow files the release changed or removed and not the one it added", () => {
      arrange(sandbox, { ...WITH_WORKFLOWS, release: RELEASE_WORKFLOWS });

      const result = update(sandbox);

      expect(result.exitCode, "exit code").toBe(0);
      expect(result.summary.trimEnd(), "summary of the run").toBe(
        `${updated(TAG_FROM, TAG_TO)}\n\n${workflowLine(THREE)}`,
      );
    });

    it("tells a button copy that has only update.yml only about update.yml", () => {
      arrange(sandbox, {
        release: RELEASE_WORKFLOWS,
        local: { [UPDATE_WORKFLOW]: numbered("update") },
      });

      const result = update(sandbox);

      expect(result.exitCode, "exit code").toBe(0);
      expect(result.summary.trimEnd(), "summary of the run").toBe(
        `${updated(TAG_FROM, TAG_TO)}\n\n${workflowLine([UPDATE_WORKFLOW])}`,
      );
    });

    it("does not list a file the copy already took over", () => {
      arrange(sandbox, {
        ...WITH_WORKFLOWS,
        release: RELEASE_WORKFLOWS,
        local: { [UPDATE_WORKFLOW]: numbered("update", { 4: "release v2" }) },
      });

      const result = update(sandbox);

      expect(result.exitCode, "exit code").toBe(0);
      expect(result.summary.trimEnd(), "summary of the run").toBe(
        `${updated(TAG_FROM, TAG_TO)}\n\n${workflowLine([CODEQL, OLD_WORKFLOW])}`,
      );
    });

    it("leaves the line out when no changed workflow file differs", () => {
      arrange(sandbox, {
        ...WITH_WORKFLOWS,
        release: RELEASE_WORKFLOWS,
        local: {
          [CODEQL]: numbered("codeql", { 4: "release v2" }),
          [UPDATE_WORKFLOW]: numbered("update", { 4: "release v2" }),
          [OLD_WORKFLOW]: null,
        },
      });

      const result = update(sandbox);

      expectGreen(result, updated(TAG_FROM, TAG_TO));
    });

    it("reports no conflict for a workflow file the copy and the release changed, keeps the copy's file and lists it", () => {
      const own = numbered("codeql", { 4: "my own change" });
      arrange(sandbox, {
        ...WITH_WORKFLOWS,
        release: { [CODEQL]: numbered("codeql", { 4: "release v2" }) },
        local: { [CODEQL]: own },
      });

      const result = update(sandbox);

      expect(result.exitCode, "exit code").toBe(0);
      expect(result.summary.trimEnd(), "summary of the run").toBe(
        `${updated(TAG_FROM, TAG_TO)}\n\n${workflowLine([CODEQL])}`,
      );
      expect(readOriginFile(sandbox, CODEQL), "codeql.yml of the copy").toBe(own);
    });

    it("keeps and does not list a workflow file only the copy has", () => {
      arrange(sandbox, {
        ...WITH_WORKFLOWS,
        release: { [CODEQL]: numbered("codeql", { 4: "release v2" }) },
        local: { [OWN_WORKFLOW]: numbered("mine") },
      });

      const result = update(sandbox);

      expect(result.summary.trimEnd(), "summary of the run").toBe(
        `${updated(TAG_FROM, TAG_TO)}\n\n${workflowLine([CODEQL])}`,
      );
      expect(readOriginFile(sandbox, OWN_WORKFLOW), "the copy's own workflow file").toBe(numbered("mine"));
    });
  });

  describe("AC10: a fork and a button copy are updated alike", () => {
    const KINDS = ["fork", "button"] as const;

    it.each(KINDS)("%s: updates as in AC1 and keeps the local change", (kind) => {
      arrange(sandbox, { kind, local: { [README]: numbered("readme", { 9: "local note" }) } });

      const result = update(sandbox);

      expectGreen(result, updated(TAG_FROM, TAG_TO));
      expect(readOriginFile(sandbox, README), "README.md of the copy").toBe(
        numbered("readme", { 2: "release note", 9: "local note" }),
      );
      expect(readOriginFile(sandbox, WRANGLER), "wrangler.jsonc of the copy").toBe(
        wranglerText({ ...BUTTON_PARTS, compatibilityDate: "2026-03-01" }),
      );
    });

    it.each(KINDS)("%s: reports the conflict as in AC4", (kind) => {
      arrange(sandbox, {
        kind,
        release: { [GUIDE]: numbered("guide", { 5: "release line" }) },
        local: { [GUIDE]: numbered("guide", { 6: "local line" }) },
      });

      const result = update(sandbox);

      expectRed(result, conflictOf(TAG_TO, GUIDE));
    });
  });

  describe("AC11: the base of the update", () => {
    /** Upstream has a revised change and a reverted one between v0.4.0 and v0.5.0; the copy was built in between. */
    function arrangeBetweenReleases(): void {
      commitUpstream(sandbox, baseFiles(FROM), TAG_FROM);
      const between = commitUpstream(sandbox, {
        [GUIDE]: numbered("guide", { 4: "feature one" }),
        [INDEX]: numbered("index", { 7: "experiment" }),
      });
      commitUpstream(
        sandbox,
        {
          ...releaseChanges(TO),
          [GUIDE]: numbered("guide", { 4: "feature two" }),
          [INDEX]: numbered("index", { 3: "release change" }),
        },
        TAG_TO,
      );
      createCopy(sandbox, "button", between, buttonEdits(FROM));
    }

    it("raises no conflict for an upstream change the copy holds and the release revised, and ends as in the release", () => {
      arrangeBetweenReleases();

      const result = update(sandbox);

      expectGreen(result, updated(TAG_FROM, TAG_TO));
      expect(readOriginFile(sandbox, GUIDE), "docs/guide.md of the copy").toBe(numbered("guide", { 4: "feature two" }));
    });

    it("removes an upstream change the copy holds and upstream reverted before the release", () => {
      arrangeBetweenReleases();

      update(sandbox);

      expect(readOriginFile(sandbox, INDEX), "src/index.ts of the copy").toBe(
        numbered("index", { 3: "release change" }),
      );
    });

    it("keeps a local change of the copy built in between", () => {
      arrangeBetweenReleases();
      commitToCopy(sandbox, { [README]: numbered("readme", { 9: "local note" }) }, "Local change");

      update(sandbox);

      expect(readOriginFile(sandbox, README), "README.md of the copy").toBe(
        numbered("readme", { 2: "release note", 9: "local note" }),
      );
    });

    it("updates a copy that this workflow updated before from that release, with a commit of the owner in between", () => {
      const base = commitUpstream(sandbox, baseFiles(FROM), TAG_FROM);
      commitUpstream(sandbox, { ...releaseChanges(TO), [GUIDE]: numbered("guide", { 3: "second" }) }, TAG_TO);
      commitUpstream(sandbox, { ...releaseChanges("0.6.0"), [GUIDE]: numbered("guide", { 3: "third" }) }, "v0.6.0");
      createCopy(sandbox, "button", base, buttonEdits(FROM));
      update(sandbox);
      commitToCopy(sandbox, { [README]: numbered("readme", { 2: "release note", 9: "owner note" }) }, "Owner change");

      const result = update(sandbox, {}, "v0.6.0");

      expectGreen(result, updated(TAG_TO, "v0.6.0"));
      expect(readOriginFile(sandbox, GUIDE), "docs/guide.md of the copy").toBe(numbered("guide", { 3: "third" }));
      expect(readOriginFile(sandbox, README), "README.md of the copy").toBe(
        numbered("readme", { 2: "release note", 9: "owner note" }),
      );
    });

    it("updates a fork from the merge base although a fork commit carries a Seluna-Release trailer of an old release", () => {
      commitUpstream(sandbox, { ...baseFiles("0.1.0"), [GUIDE]: numbered("guide", { 3: "old" }) }, "v0.1.0");
      const base = commitUpstream(
        sandbox,
        { [PACKAGE_JSON]: packageText(FROM), [GUIDE]: numbered("guide", { 3: "mid" }) },
        TAG_FROM,
      );
      commitUpstream(sandbox, { ...releaseChanges(TO), [GUIDE]: numbered("guide", { 3: "new" }) }, TAG_TO);
      createCopy(sandbox, "fork", base, buttonEdits(FROM));
      commitToCopy(
        sandbox,
        { [README]: numbered("readme", { 9: "squashed" }) },
        "Update Seluna to v0.1.0\n\nSeluna-Release: v0.1.0",
      );

      const result = update(sandbox);

      expectGreen(result, updated(TAG_FROM, TAG_TO));
      expect(readOriginFile(sandbox, GUIDE), "docs/guide.md of the copy").toBe(numbered("guide", { 3: "new" }));
    });

    it("matches a button copy built as the real button does, between releases, to its upstream commit", () => {
      arrangeBetweenReleases();

      const result = update(sandbox);

      expectGreen(result, updated(TAG_FROM, TAG_TO));
      expect(readOriginFile(sandbox, PACKAGE_JSON), "package.json of the copy").toBe(packageText(TO, BUTTON_NAME));
    });
  });

  describe("AC12: the base cannot be found", () => {
    it("fails with the message of E15 when no trailer, no shared history and no matching upstream commit exist", () => {
      arrange(sandbox, { buttonEdits: { ...buttonEdits(FROM), [INDEX]: "a different file\n" } });

      const result = update(sandbox);

      expectRed(result, UNKNOWN_BASE);
    });

    it("fails with the message of E15 for a trailer that names a tag upstream lacks, without falling back", () => {
      arrange(sandbox);
      commitToCopy(
        sandbox,
        { [README]: numbered("readme", { 9: "update" }) },
        "Update Seluna to v9.9.9\n\nSeluna-Release: v9.9.9",
        "bot",
      );

      const result = update(sandbox);

      expectRed(result, UNKNOWN_BASE);
    });

    it("fails with the message of E15 when two upstream commits match the first commit and differ in wrangler.jsonc", () => {
      const base = commitUpstream(sandbox, baseFiles(FROM), TAG_FROM);
      commitUpstream(sandbox, { [WRANGLER]: wranglerText({ compatibilityDate: "2026-02-01" }) });
      commitUpstream(sandbox, releaseChanges(TO), TAG_TO);
      createCopy(sandbox, "button", base, buttonEdits(FROM));

      const result = update(sandbox);

      expectRed(result, UNKNOWN_BASE);
    });

    it("accepts two matching upstream commits that differ only in a workflow file", () => {
      const base = commitUpstream(sandbox, baseFiles(FROM), TAG_FROM);
      commitUpstream(sandbox, { [CODEQL]: numbered("codeql", { 2: "changed later" }) });
      commitUpstream(sandbox, releaseChanges(TO), TAG_TO);
      createCopy(sandbox, "button", base, buttonEdits(FROM));

      const result = update(sandbox);

      expectGreen(result, updated(TAG_FROM, TAG_TO));
    });

    it("fails with the message of E15 when package.json differs from every candidate in more than the name line", () => {
      arrange(sandbox, {
        buttonEdits: {
          ...buttonEdits(FROM),
          [PACKAGE_JSON]: packageText(FROM, BUTTON_NAME).replace("true", "false"),
        },
      });

      const result = update(sandbox);

      expectRed(result, UNKNOWN_BASE);
    });
  });

  describe("AC13: docs/update.md", () => {
    const SECTIONS_OF_WORKFLOW = ["Conflicts", "Permissions", "Unknown base", "Workflow files"];

    function sectionsNamedByWorkflow(): readonly string[] {
      const names = [...readWorkflowText().matchAll(/docs\/update\.md, \\?"([^"\\]+)\\?"/g)].map(
        (match) => match[1] ?? "",
      );
      return [...new Set(names)].sort((a, b) => a.localeCompare(b));
    }

    it("names the sections Conflicts, Permissions, Unknown base and Workflow files", () => {
      expect(sectionsNamedByWorkflow(), "sections named by the workflow").toEqual(SECTIONS_OF_WORKFLOW);
    });

    it("has a heading for every section the workflow names and for the other sections of the guide", () => {
      const headings = readRepositoryFile("docs/update.md")
        .split("\n")
        .filter((line) => line.startsWith("#"))
        .map((line) => line.replace(/^#+/, "").trim());

      expect(headings, "headings of docs/update.md").toEqual(
        expect.arrayContaining([
          ...SECTIONS_OF_WORKFLOW,
          "Start the update",
          "Add the workflow to an older copy",
          "New major version",
          "After the update",
        ]),
      );
    });

    it("is linked from docs/setup.md", () => {
      expect(readRepositoryFile("docs/setup.md"), "docs/setup.md").toMatch(/\]\((\.\/)?update\.md(#[^)]*)?\)/);
    });
  });
});
