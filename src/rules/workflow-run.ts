import type { PullRequestRef } from "../github/api-client";
import { isRecord, recordField, stringField } from "./pull-request";
import type { WebhookPayload } from "./rule";

/** The fields of a failed `workflow_run` delivery the CI rules read, narrowed. */
export interface FailedWorkflowRun {
  /** `repository.full_name`. */
  readonly repository: string;
  /** `workflow_run.head_branch`. */
  readonly branch: string;
  /** Whether `head_branch` is `repository.default_branch` and `head_repository.id` is `repository.id`. */
  readonly onDefaultBranch: boolean;
  /** `workflow_run.name`. */
  readonly workflow: string;
  /** `workflow_run.html_url`. */
  readonly url: string;
  /** Line 3: the branch, then ` · ` and the first commit line when there is one. */
  readonly context: string;
  /** The number of the first `pull_requests` entry of the repository, or `undefined`. */
  readonly pullRequestNumber: number | undefined;
}

const FAILED_CONCLUSIONS: ReadonlySet<string> = new Set(["failure", "timed_out"]);
const LINE_BREAK = /[\n\r]/;
const CONTEXT_SEPARATOR = " · ";

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/** The fields of a `workflow_run` `completed` delivery with conclusion `failure` or `timed_out`; otherwise `undefined`. */
export function failedWorkflowRun(event: string, payload: WebhookPayload): FailedWorkflowRun | undefined {
  if (event !== "workflow_run" || payload.action !== "completed") {
    return undefined;
  }
  const run = recordField(payload, "workflow_run");
  const repository = recordField(payload, "repository");
  const headRepository = run === undefined ? undefined : recordField(run, "head_repository");
  if (run === undefined || repository === undefined || headRepository === undefined) {
    return undefined;
  }
  const conclusion = stringField(run, "conclusion");
  const branch = stringField(run, "head_branch");
  const workflow = stringField(run, "name");
  const url = stringField(run, "html_url");
  const fullName = stringField(repository, "full_name");
  const defaultBranch = stringField(repository, "default_branch");
  const repositoryId = repository.id;
  const headRepositoryId = headRepository.id;
  if (
    conclusion === undefined ||
    !FAILED_CONCLUSIONS.has(conclusion) ||
    branch === undefined ||
    workflow === undefined ||
    url === undefined ||
    fullName === undefined ||
    defaultBranch === undefined ||
    !isPositiveSafeInteger(repositoryId) ||
    !isPositiveSafeInteger(headRepositoryId)
  ) {
    return undefined;
  }
  const commit = recordField(run, "head_commit");
  const commitLine = firstCommitLine(commit?.message);
  return {
    repository: fullName,
    branch,
    onDefaultBranch: branch === defaultBranch && headRepositoryId === repositoryId,
    workflow,
    url,
    context: commitLine === "" ? branch : `${branch}${CONTEXT_SEPARATOR}${commitLine}`,
    pullRequestNumber: pullRequestNumberOf(run.pull_requests, repositoryId),
  };
}

/** The text before the first line feed or carriage return, trimmed; `""` when `message` is not a string. */
export function firstCommitLine(message: unknown): string {
  if (typeof message !== "string") {
    return "";
  }
  return (message.split(LINE_BREAK, 1)[0] ?? "").trim();
}

/** The `number` of the first entry whose `base.repo.id` is `repositoryId` (both positive safe integers), else `undefined`. */
export function pullRequestNumberOf(pullRequests: unknown, repositoryId: number): number | undefined {
  if (!Array.isArray(pullRequests)) {
    return undefined;
  }
  for (const entry of pullRequests as readonly unknown[]) {
    if (!isRecord(entry) || !isPositiveSafeInteger(entry.number)) {
      continue;
    }
    const baseRepository = recordField(recordField(entry, "base") ?? {}, "repo");
    if (isPositiveSafeInteger(baseRepository?.id) && baseRepository.id === repositoryId) {
      return entry.number;
    }
  }
  return undefined;
}

/** The pull request `number` in the repository `fullName` (`owner/name`, split at the first `/`). */
export function pullRequestRefOf(fullName: string, number: number): PullRequestRef {
  const slash = fullName.indexOf("/");
  return { owner: fullName.slice(0, slash), repo: fullName.slice(slash + 1), number };
}
