import type { PullRequestRef } from "../github/api-client";
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

/** The fields of a `workflow_run` `completed` delivery with conclusion `failure` or `timed_out`; otherwise `undefined`. */
export function failedWorkflowRun(event: string, payload: WebhookPayload): FailedWorkflowRun | undefined {
  void event;
  void payload;
  throw new Error("Not implemented");
}

/** The text before the first line feed or carriage return, trimmed; `""` when `message` is not a string. */
export function firstCommitLine(message: unknown): string {
  void message;
  throw new Error("Not implemented");
}

/** The `number` of the first entry whose `base.repo.id` is `repositoryId` (both positive safe integers), else `undefined`. */
export function pullRequestNumberOf(pullRequests: unknown, repositoryId: number): number | undefined {
  void pullRequests;
  void repositoryId;
  throw new Error("Not implemented");
}

/** The pull request `number` in the repository `fullName` (`owner/name`, split at the first `/`). */
export function pullRequestRefOf(fullName: string, number: number): PullRequestRef {
  void fullName;
  void number;
  throw new Error("Not implemented");
}
