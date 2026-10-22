/// <reference types="node" />
/**
 * Harness of `test/update-workflow.test.ts` (decision 0032): runs the script of `.github/workflows/update.yml`, exactly
 * as it is written there, against local Git repositories. No network and no clock is used:
 *
 * - `https://github.com/LarsLaskowski/Seluna.git` and `https://github.com/<copy>.git` are redirected to bare
 *   repositories of the sandbox by `url.<path>.insteadOf` in a Git configuration file of the sandbox;
 * - `curl` is a script first on `PATH` that answers the release request from the options of the run;
 * - `git` is wrapped only when a run asks for it (`moveMainDuringRun`, `failingGitCommand`, `recordHeaderMatch`);
 * - the commits of the harness carry fixed dates.
 *
 * The script runs with an explicit environment, never with `process.env`.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** A set of file changes: a string writes the file, `null` deletes it. */
export type FileTree = Readonly<Record<string, string | null>>;

/** What the fake `curl` answers to the request for the latest release. */
export type ReleaseAnswer =
  | { readonly kind: "release"; readonly tag: string }
  | { readonly kind: "status"; readonly status: number }
  | { readonly kind: "body"; readonly body: string }
  | { readonly kind: "no-answer" };

/** `fork` shares history with the upstream repository; `button` starts with one unrelated root commit. */
export type CopyKind = "fork" | "button";

export interface Sandbox {
  readonly root: string;
  /** The bare repository behind `https://github.com/LarsLaskowski/Seluna.git`. */
  readonly upstream: string;
  /** The bare repository behind `https://github.com/<copyName>.git`. */
  readonly origin: string;
  readonly copyName: string;
}

export interface RunOptions {
  readonly release: ReleaseAnswer;
  /** `GITHUB_REPOSITORY`; default the sandbox's copy name. */
  readonly repository?: string;
  /** `GITHUB_REF`; default `refs/heads/main`. */
  readonly ref?: string;
  /** The input **Allow a new major version**; default off. */
  readonly allowMajor?: boolean;
  /** Origin refuses every push to `main`. */
  readonly refusePush?: boolean;
  /** A commit lands on origin's `main` just before the script runs `git merge-tree`. */
  readonly moveMainDuringRun?: boolean;
  /** The Git subcommand (for example `merge-tree`) that fails with exit 128. */
  readonly failingGitCommand?: string;
  /** Record which `http.extraheader` applies to the copy's and the upstream URL when the script clones. */
  readonly recordHeaderMatch?: boolean;
}

export interface RunResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  /** The content of `GITHUB_STEP_SUMMARY`. */
  readonly summary: string;
  /** How often the script called `curl`. */
  readonly curlCalls: number;
  readonly originMainBefore: string;
  readonly originMainAfter: string;
  /** URL -> header value, "" when none applies; empty unless `recordHeaderMatch` was set and the script cloned. */
  readonly headerMatches: Readonly<Record<string, string>>;
  /** What the script had printed to stdout when it started its first `git clone`; "" unless `recordHeaderMatch`. */
  readonly stdoutAtClone: string;
}

export interface OriginCommit {
  readonly parents: readonly string[];
  /** The whole message without the trailing newline. */
  readonly message: string;
  /** Paths the commit changes against its parent (renames as a delete and an add). */
  readonly changedPaths: readonly string[];
}

/** The throwaway token the script receives as `REPO_TOKEN`. */
export const TEST_TOKEN = "test-token-not-a-secret";

/** The committer of the update commits, as the script sets it (plan, step 12). */
export const BOT_NAME = "github-actions[bot]";
export const BOT_EMAIL = "41898282+github-actions[bot]@users.noreply.github.com";

export type Committer = "owner" | "bot";

const GIT = "/usr/bin/git";
const BASH = "/usr/bin/bash";
const SYSTEM_PATH = "/usr/bin:/bin";
const COPY_NAME = "alice/my-seluna";
const UPSTREAM_URL = "https://github.com/LarsLaskowski/Seluna.git";
const FIRST_COMMIT_SECONDS = 1_767_225_600; // 2026-01-01T00:00:00Z
const RUN_TIMEOUT_MS = 60_000;

const HARNESS_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = join(HARNESS_DIRECTORY, "..");
const WORKFLOW_PATH = join(REPOSITORY_ROOT, ".github", "workflows", "update.yml");
const RELEASE_FIXTURE_PATH = join(HARNESS_DIRECTORY, "fixtures", "github", "release-latest.json");

interface Identity {
  readonly name: string;
  readonly email: string;
}

const IDENTITIES: Readonly<Record<Committer | "upstream", Identity>> = {
  upstream: { name: "Upstream Dev", email: "upstream@example.invalid" },
  owner: { name: "Owner", email: "owner@example.invalid" },
  bot: { name: BOT_NAME, email: BOT_EMAIL },
};

/** Number of commits made so far per sandbox root, for the fixed commit dates. */
const commitCounts = new Map<string, number>();

/** The fake `curl`: answers from `curl-code` and `curl-body` next to it and counts its calls. */
const FAKE_CURL = `#!/usr/bin/env bash
here=$(dirname "\${BASH_SOURCE[0]}")
printf 'call\\n' >> "$here/curl-calls"
out=""
fmt=""
maxsize=""
while (($#)); do
  case "$1" in
    -o|--output) out="$2"; shift 2 ;;
    --output=*) out="\${1#--output=}"; shift ;;
    -w|--write-out) fmt="$2"; shift 2 ;;
    --write-out=*) fmt="\${1#--write-out=}"; shift ;;
    --max-filesize) maxsize="$2"; shift 2 ;;
    --max-filesize=*) maxsize="\${1#--max-filesize=}"; shift ;;
    *) shift ;;
  esac
done
code=$(<"$here/curl-code")
if [[ $code == no-answer ]]; then
  [[ -n $fmt ]] && printf '000'
  exit 28
fi
if [[ -n $maxsize ]] && (( $(stat -c %s "$here/curl-body") > maxsize )); then
  [[ -n $fmt ]] && printf '%s' "\${fmt//%\\{http_code\\}/$code}"
  exit 63
fi
if [[ -n $out ]]; then
  cp "$here/curl-body" "$out"
else
  cat "$here/curl-body"
fi
[[ -n $fmt ]] && printf '%s' "\${fmt//%\\{http_code\\}/$code}"
exit 0
`;

/** The fake `git`: acts before the real Git for the subcommands the options of a run name. */
const FAKE_GIT = `#!/usr/bin/env bash
here=$(dirname "\${BASH_SOURCE[0]}")
real=/usr/bin/git
sub=""
skip=0
for arg in "$@"; do
  if ((skip)); then skip=0; continue; fi
  case "$arg" in
    -c|-C) skip=1 ;;
    -*) ;;
    *) sub="$arg"; break ;;
  esac
done
if [[ -f "$here/fail-command" && "$sub" == "$(<"$here/fail-command")" ]]; then
  printf 'fatal: simulated failure\\n' >&2
  exit 128
fi
if [[ -f "$here/move-main" && "$sub" == merge-tree && ! -f "$here/moved" ]]; then
  : > "$here/moved"
  origin=$(<"$here/origin-path")
  tree=$("$real" --git-dir="$origin" rev-parse 'refs/heads/main^{tree}')
  parent=$("$real" --git-dir="$origin" rev-parse refs/heads/main)
  moved=$(GIT_AUTHOR_NAME=Owner GIT_AUTHOR_EMAIL=owner@example.invalid GIT_COMMITTER_NAME=Owner \\
    GIT_COMMITTER_EMAIL=owner@example.invalid "$real" --git-dir="$origin" commit-tree "$tree" -p "$parent" \\
    -m 'Owner commit during the update')
  "$real" --git-dir="$origin" update-ref refs/heads/main "$moved"
fi
if [[ -f "$here/record-header" && "$sub" == clone && ! -f "$here/header-matches" ]]; then
  copy_url=$(<"$here/copy-url")
  for url in "$copy_url/info/refs" "${UPSTREAM_URL}/info/refs"; do
    value=$("$real" config --get-urlmatch http.extraheader "$url" || true)
    printf '%s\\t%s\\n' "$url" "$value" >> "$here/header-matches"
  done
  cp "$(<"$here/stdout-path")" "$here/stdout-at-clone"
fi
exec "$real" "$@"
`;

function nextStamp(sandbox: Sandbox): string {
  const count = commitCounts.get(sandbox.root) ?? 0;
  commitCounts.set(sandbox.root, count + 1);
  return `${String(FIRST_COMMIT_SECONDS + count)} +0000`;
}

function baseEnv(sandbox: Sandbox): Record<string, string> {
  return {
    PATH: SYSTEM_PATH,
    HOME: join(sandbox.root, "home"),
    GIT_CONFIG_GLOBAL: join(sandbox.root, "gitconfig"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    LC_ALL: "C",
  };
}

function git(sandbox: Sandbox, args: readonly string[], cwd: string = sandbox.root, who?: Identity): string {
  const env =
    who === undefined
      ? baseEnv(sandbox)
      : {
          ...baseEnv(sandbox),
          GIT_AUTHOR_NAME: who.name,
          GIT_AUTHOR_EMAIL: who.email,
          GIT_AUTHOR_DATE: nextStamp(sandbox),
          GIT_COMMITTER_NAME: who.name,
          GIT_COMMITTER_EMAIL: who.email,
          GIT_COMMITTER_DATE: nextStamp(sandbox),
        };
  return execFileSync(GIT, args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function applyTree(directory: string, files: FileTree): void {
  for (const [path, content] of Object.entries(files)) {
    const target = join(directory, path);
    if (content === null) {
      rmSync(target, { force: true });
    } else {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content);
      if (path.endsWith(".sh")) {
        chmodSync(target, 0o755); // by convention a `.sh` file of the sandbox is executable (mode 100755)
      }
    }
  }
}

function writeExecutable(path: string, content: string): void {
  writeFileSync(path, content);
  chmodSync(path, 0o755);
}

/** Clones origin, applies `files`, commits as `who` and pushes to origin's `main`; returns the new commit. */
function commitOnOrigin(sandbox: Sandbox, files: FileTree, message: string, who: Identity): string {
  const work = join(sandbox.root, "copy-work");
  rmSync(work, { recursive: true, force: true });
  git(sandbox, ["clone", "-q", sandbox.origin, work]);
  applyTree(work, files);
  git(sandbox, ["add", "-A"], work);
  git(sandbox, ["commit", "-q", "--allow-empty", "-m", message], work, who);
  git(sandbox, ["push", "-q", "origin", "HEAD:refs/heads/main"], work);
  return git(sandbox, ["rev-parse", "HEAD"], work).trim();
}

function originGit(sandbox: Sandbox, args: readonly string[]): string {
  return git(sandbox, ["--git-dir", sandbox.origin, ...args]);
}

/** Creates the sandbox: empty bare upstream and origin repositories and the Git configuration that redirects both URLs. */
export function createSandbox(): Sandbox {
  const root = mkdtempSync(join(tmpdir(), "seluna-update-"));
  const sandbox: Sandbox = {
    root,
    upstream: join(root, "upstream.git"),
    origin: join(root, "origin.git"),
    copyName: COPY_NAME,
  };
  for (const directory of ["home", "tmp", "fakebin", "run", "upstream-work"]) {
    mkdirSync(join(root, directory));
  }
  writeFileSync(
    join(root, "gitconfig"),
    [
      "[user]",
      "\tname = Harness",
      "\temail = harness@example.invalid",
      "[init]",
      "\tdefaultBranch = main",
      "[safe]",
      "\tdirectory = *",
      "[advice]",
      "\tdetachedHead = false",
      `[url "${sandbox.upstream}"]`,
      `\tinsteadOf = ${UPSTREAM_URL}`,
      `[url "${sandbox.origin}"]`,
      `\tinsteadOf = https://github.com/${COPY_NAME}.git`,
      "",
    ].join("\n"),
  );
  git(sandbox, ["init", "-q", "--bare", "-b", "main", sandbox.upstream]);
  git(sandbox, ["init", "-q", "--bare", "-b", "main", sandbox.origin]);
  git(sandbox, ["init", "-q", "-b", "main", join(root, "upstream-work")]);
  return sandbox;
}

export function removeSandbox(sandbox: Sandbox): void {
  commitCounts.delete(sandbox.root);
  rmSync(sandbox.root, { recursive: true, force: true });
}

/**
 * Commits `files` (a change on top of the previous upstream state, `null` deletes a file) to the upstream
 * repository's `main`, tags it when `tag` is given, and returns the commit.
 */
export function commitUpstream(sandbox: Sandbox, files: FileTree, tag?: string): string {
  const work = join(sandbox.root, "upstream-work");
  applyTree(work, files);
  git(sandbox, ["add", "-A"], work);
  git(
    sandbox,
    ["commit", "-q", "--allow-empty", "-m", tag === undefined ? "Upstream change" : `Release ${tag}`],
    work,
    IDENTITIES.upstream,
  );
  const commit = git(sandbox, ["rev-parse", "HEAD"], work).trim();
  const pushed = tag === undefined ? [] : [`refs/tags/${tag}`];
  if (tag !== undefined) {
    git(sandbox, ["tag", tag], work);
  }
  git(sandbox, ["push", "-q", sandbox.upstream, "HEAD:refs/heads/main", ...pushed], work);
  return commit;
}

/**
 * Creates the copy in origin from the upstream commit `fromCommit`. A `fork` holds the upstream history up to that
 * commit, and `edits` are one commit on top. A `button` copy holds one unrelated root commit with the files of that
 * commit and `edits` applied, as the Deploy to Cloudflare button makes it. Returns the head of origin's `main`.
 */
export function createCopy(sandbox: Sandbox, kind: CopyKind, fromCommit: string, edits: FileTree): string {
  if (kind === "fork") {
    git(sandbox, ["--git-dir", sandbox.upstream, "push", "-q", sandbox.origin, `${fromCommit}:refs/heads/main`]);
    return Object.keys(edits).length === 0
      ? fromCommit
      : commitOnOrigin(sandbox, edits, "Set up the repository", IDENTITIES.owner);
  }
  const work = join(sandbox.root, "button-work");
  rmSync(work, { recursive: true, force: true });
  git(sandbox, ["clone", "-q", "--no-checkout", sandbox.upstream, work]);
  git(sandbox, ["checkout", "-q", "--detach", fromCommit], work);
  rmSync(join(work, ".git"), { recursive: true, force: true });
  applyTree(work, edits);
  git(sandbox, ["init", "-q", "-b", "main"], work);
  git(sandbox, ["add", "-A"], work);
  git(sandbox, ["commit", "-q", "-m", "Initial commit"], work, IDENTITIES.owner);
  git(sandbox, ["push", "-q", sandbox.origin, "main:refs/heads/main"], work);
  return git(sandbox, ["rev-parse", "HEAD"], work).trim();
}

/** Commits `files` on top of origin's `main` as `committer` (default the owner) and returns the commit. */
export function commitToCopy(
  sandbox: Sandbox,
  files: FileTree,
  message: string,
  committer: Committer = "owner",
): string {
  return commitOnOrigin(sandbox, files, message, IDENTITIES[committer]);
}

/** The Git mode of `path` at `ref` in origin (default `main`), for example `100755`, or `null` when it does not exist. */
export function readOriginMode(sandbox: Sandbox, path: string, ref = "refs/heads/main"): string | null {
  const line = originGit(sandbox, ["ls-tree", ref, "--", path]).trim();
  return line === "" ? null : (line.split(" ")[0] ?? null);
}

/** The content of `path` at `ref` in origin (default `main`), or `null` when the file does not exist there. */
export function readOriginFile(sandbox: Sandbox, path: string, ref = "refs/heads/main"): string | null {
  try {
    return originGit(sandbox, ["cat-file", "blob", `${ref}:${path}`]);
  } catch {
    return null;
  }
}

export function originCommit(sandbox: Sandbox, ref: string): OriginCommit {
  const parents = originGit(sandbox, ["rev-list", "--parents", "-n", "1", ref]).trim().split(" ").slice(1);
  const message = originGit(sandbox, ["log", "-1", "--format=%B", ref]).trimEnd();
  const changedPaths = originGit(sandbox, ["diff-tree", "-r", "--root", "--no-commit-id", "--name-only", "-z", ref])
    .split("\0")
    .filter((path) => path !== "");
  return { parents, message, changedPaths };
}

/** The text of `.github/workflows/update.yml`. */
export function readWorkflowText(): string {
  return readFileSync(WORKFLOW_PATH, "utf8");
}

/** The text of a file of this repository, `path` relative to the repository root. */
export function readRepositoryFile(path: string): string {
  return readFileSync(join(REPOSITORY_ROOT, path), "utf8");
}

/** The `run: |` block of the step with `id: update`, dedented. Throws when the workflow has no such block. */
export function extractUpdateScript(workflowText: string): string {
  const lines = workflowText.split("\n");
  const idIndex = lines.findIndex((line) => /^\s*(- )?id:\s*update\s*$/.test(line));
  if (idIndex < 0) {
    throw new Error("The workflow has no step with the id update.");
  }
  const runIndex = lines.findIndex((line, index) => index > idIndex && /^\s*run:\s*\|[-+]?\s*$/.test(line));
  if (runIndex < 0) {
    throw new Error("The step update has no run block.");
  }
  const keyIndent = (/^\s*/.exec(lines[runIndex] ?? "") ?? [""])[0].length;
  const block: string[] = [];
  for (const line of lines.slice(runIndex + 1)) {
    const indent = (/^\s*/.exec(line) ?? [""])[0].length;
    if (line.trim() !== "" && indent <= keyIndent) {
      break;
    }
    block.push(line);
  }
  const firstContent = block.find((line) => line.trim() !== "") ?? "";
  const contentIndent = (/^\s*/.exec(firstContent) ?? [""])[0].length;
  const dedented = block.map((line) => (line.trim() === "" ? "" : line.slice(contentIndent)));
  while (dedented.length > 0 && dedented[dedented.length - 1] === "") {
    dedented.pop();
  }
  return `${dedented.join("\n")}\n`;
}

function releaseBody(tag: string): string {
  const fixture: unknown = JSON.parse(readFileSync(RELEASE_FIXTURE_PATH, "utf8"));
  return JSON.stringify({ ...(fixture as Record<string, unknown>), tag_name: tag, name: tag });
}

function answerOf(answer: ReleaseAnswer): { readonly code: string; readonly body: string } {
  switch (answer.kind) {
    case "release":
      return { code: "200", body: releaseBody(answer.tag) };
    case "status":
      return { code: String(answer.status), body: '{"message":"fake"}' };
    case "body":
      return { code: "200", body: answer.body };
    case "no-answer":
      return { code: "no-answer", body: "" };
  }
}

function mainOfOrigin(sandbox: Sandbox): string {
  return originGit(sandbox, ["rev-parse", "refs/heads/main"]).trim();
}

function readOptional(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function parseHeaderMatches(text: string): Readonly<Record<string, string>> {
  const matches: Record<string, string> = {};
  for (const line of text.split("\n").filter((entry) => entry !== "")) {
    const [url = "", value = ""] = line.split("\t");
    matches[url] = value;
  }
  return matches;
}

/**
 * Runs the script of the workflow once against the sandbox, with the explicit environment of the plan (`PATH` with the
 * fakes first, `HOME` inside the sandbox, no `process.env`), and reports what it printed and what happened to origin.
 */
export function runUpdate(sandbox: Sandbox, options: RunOptions): RunResult {
  const script = extractUpdateScript(readWorkflowText());
  const fakes = join(sandbox.root, "fakebin");
  const run = join(sandbox.root, "run");
  const stdoutPath = join(run, "stdout.txt");
  const stderrPath = join(run, "stderr.txt");
  const summaryPath = join(run, "summary.md");
  const lockPath = join(sandbox.origin, "refs", "heads", "main.lock");
  const wrapsGit =
    options.moveMainDuringRun === true || options.failingGitCommand !== undefined || options.recordHeaderMatch === true;

  for (const state of [
    "curl-calls",
    "header-matches",
    "stdout-at-clone",
    "moved",
    "move-main",
    "fail-command",
    "record-header",
  ]) {
    rmSync(join(fakes, state), { force: true });
  }
  const answer = answerOf(options.release);
  writeFileSync(join(run, "update.sh"), script);
  writeFileSync(summaryPath, "");
  writeExecutable(join(fakes, "curl"), FAKE_CURL);
  writeFileSync(join(fakes, "curl-code"), answer.code);
  writeFileSync(join(fakes, "curl-body"), answer.body);
  writeFileSync(join(fakes, "origin-path"), sandbox.origin);
  writeFileSync(join(fakes, "copy-url"), `https://github.com/${sandbox.copyName}.git`);
  writeFileSync(join(fakes, "stdout-path"), stdoutPath);
  if (wrapsGit) {
    writeExecutable(join(fakes, "git"), FAKE_GIT);
  } else {
    rmSync(join(fakes, "git"), { force: true });
  }
  if (options.moveMainDuringRun === true) {
    writeFileSync(join(fakes, "move-main"), "");
  }
  if (options.failingGitCommand !== undefined) {
    writeFileSync(join(fakes, "fail-command"), options.failingGitCommand);
  }
  if (options.recordHeaderMatch === true) {
    writeFileSync(join(fakes, "record-header"), "");
  }

  const env: Record<string, string> = {
    ...baseEnv(sandbox),
    PATH: `${fakes}:${SYSTEM_PATH}`,
    GIT_ALLOW_PROTOCOL: "file",
    TMPDIR: join(sandbox.root, "tmp"),
    REPO_TOKEN: TEST_TOKEN,
    ALLOW_MAJOR: String(options.allowMajor ?? false),
    GITHUB_REPOSITORY: options.repository ?? sandbox.copyName,
    GITHUB_REF: options.ref ?? "refs/heads/main",
    GITHUB_STEP_SUMMARY: summaryPath,
  };

  const originMainBefore = mainOfOrigin(sandbox);
  if (options.refusePush === true) {
    writeFileSync(lockPath, "");
  }
  const stdoutFd = openSync(stdoutPath, "w");
  const stderrFd = openSync(stderrPath, "w");
  let status: number | null;
  try {
    // GitHub starts a `shell: bash` step as `bash --noprofile --norc -eo pipefail {0}`.
    status = spawnSync(BASH, ["--noprofile", "--norc", "-eo", "pipefail", join(run, "update.sh")], {
      cwd: run,
      env,
      stdio: ["ignore", stdoutFd, stderrFd],
      timeout: RUN_TIMEOUT_MS,
    }).status;
  } finally {
    closeSync(stdoutFd);
    closeSync(stderrFd);
    rmSync(lockPath, { force: true });
  }

  return {
    exitCode: status ?? -1,
    stdout: readFileSync(stdoutPath, "utf8"),
    stderr: readFileSync(stderrPath, "utf8"),
    summary: readFileSync(summaryPath, "utf8"),
    curlCalls: readOptional(join(fakes, "curl-calls"))
      .split("\n")
      .filter((line) => line !== "").length,
    originMainBefore,
    originMainAfter: mainOfOrigin(sandbox),
    headerMatches: parseHeaderMatches(readOptional(join(fakes, "header-matches"))),
    stdoutAtClone: readOptional(join(fakes, "stdout-at-clone")),
  };
}
