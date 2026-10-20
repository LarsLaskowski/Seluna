import { afterEach, describe, expect, it, vi } from "vitest";
import type { DraftResult, PullRequestRef } from "./github/api-client";
import { applyDraftChecks, boundedDraftLookup, DRAFT_LOOKUP_TIMEOUT_MS } from "./draft-lookup";
import type { DraftLookup } from "./draft-lookup";
import type { Notification } from "./rules/rule";

const INSTALLATION_ID = 3000;
const PULL_REQUEST: PullRequestRef = { owner: "example-owner", repo: "example-other-repo", number: 296 };
const UNKNOWN_TITLE = "CI failed in pull request (draft status unknown)";
const NOT_A_DRAFT: DraftResult = { kind: "ok", draft: false };
const A_DRAFT: DraftResult = { kind: "ok", draft: true };
const FAILED: DraftResult = { kind: "failed" };

afterEach(() => {
  vi.useRealTimers();
});

/** A notification that is sent only for a pull request that is not a draft. */
function checked(pullRequest: PullRequestRef = PULL_REQUEST): Notification {
  return {
    title: "CI failed in pull request",
    repository: "example-owner/example-other-repo",
    number: pullRequest.number,
    subject: "CodeQL",
    context: "test/failing-workflow · Make the check fail",
    url: "https://github.com/example-owner/example-other-repo/actions/runs/1",
    draftCheck: { pullRequest, titleWhenUnknown: UNKNOWN_TITLE },
  };
}

/** A notification without a draft check. */
function unchecked(): Notification {
  return {
    title: "CI failed on main",
    repository: "example-owner/example-repo",
    number: undefined,
    subject: "Build and deploy",
    context: "main",
    url: "https://github.com/example-owner/example-repo/actions/runs/2",
  };
}

function answering(result: DraftResult): ReturnType<typeof vi.fn<DraftLookup>> {
  return vi.fn<DraftLookup>(() => Promise.resolve(result));
}

describe("DRAFT_LOOKUP_TIMEOUT_MS", () => {
  it("DRAFT_LOOKUP_TIMEOUT_MS is 8000", () => {
    expect(DRAFT_LOOKUP_TIMEOUT_MS, "time limit").toBe(8000);
  });
});

describe("boundedDraftLookup", () => {
  it("boundedDraftLookup passes through an answer that comes in time", async () => {
    const lookup = answering(A_DRAFT);
    const sleep = vi.fn<(milliseconds: number) => Promise<void>>(() => new Promise<void>(() => undefined));

    const result = await boundedDraftLookup(lookup, 8000, sleep)(INSTALLATION_ID, PULL_REQUEST);

    expect(result, "result").toEqual(A_DRAFT);
    expect(lookup, "lookup calls").toHaveBeenCalledExactlyOnceWith(INSTALLATION_ID, PULL_REQUEST);
  });

  it("boundedDraftLookup answers failed when the lookup outlasts the time limit", async () => {
    const lookup = vi.fn<DraftLookup>(() => new Promise<DraftResult>(() => undefined));
    const sleep = vi.fn<(milliseconds: number) => Promise<void>>(() => Promise.resolve());

    const result = await boundedDraftLookup(lookup, 1234, sleep)(INSTALLATION_ID, PULL_REQUEST);

    expect(result, "result").toEqual(FAILED);
    expect(sleep, "sleep calls").toHaveBeenCalledExactlyOnceWith(1234);
  });

  it("boundedDraftLookup answers failed when the lookup rejects", async () => {
    const lookup = vi.fn<DraftLookup>(() => Promise.reject(new Error("network down")));
    const sleep = vi.fn<(milliseconds: number) => Promise<void>>(() => new Promise<void>(() => undefined));

    const result = await boundedDraftLookup(lookup, 8000, sleep)(INSTALLATION_ID, PULL_REQUEST);

    expect(result, "result").toEqual(FAILED);
  });

  it("boundedDraftLookup answers failed at 8 s and not before when the lookup never answers", async () => {
    vi.useFakeTimers();
    const lookup = vi.fn<DraftLookup>(() => new Promise<DraftResult>(() => undefined));
    const sleep = (milliseconds: number): Promise<void> =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, milliseconds);
      });
    let answer: DraftResult | undefined;
    const pending = boundedDraftLookup(
      lookup,
      DRAFT_LOOKUP_TIMEOUT_MS,
      sleep,
    )(INSTALLATION_ID, PULL_REQUEST).then((result) => {
      answer = result;
    });

    await vi.advanceTimersByTimeAsync(DRAFT_LOOKUP_TIMEOUT_MS - 1);
    const beforeTheLimit = answer;
    await vi.advanceTimersByTimeAsync(1);
    await pending;

    expect(beforeTheLimit, "answer 1 ms before the limit").toBeUndefined();
    expect(answer, "answer at the limit").toEqual(FAILED);
  });
});

describe("applyDraftChecks", () => {
  it("applyDraftChecks keeps a notification whose pull request is not a draft", async () => {
    const lookup = answering(NOT_A_DRAFT);
    const notification = checked();

    const result = await applyDraftChecks([notification], INSTALLATION_ID, lookup);

    expect(result, "notifications").toEqual([notification]);
    expect(lookup, "lookup calls").toHaveBeenCalledExactlyOnceWith(INSTALLATION_ID, PULL_REQUEST);
  });

  it("applyDraftChecks drops a notification whose pull request is a draft", async () => {
    const result = await applyDraftChecks([checked()], INSTALLATION_ID, answering(A_DRAFT));

    expect(result, "notifications").toEqual([]);
  });

  it("applyDraftChecks uses the title for an unknown draft state when the lookup fails", async () => {
    const notification = checked();

    const result = await applyDraftChecks([notification], INSTALLATION_ID, answering(FAILED));

    expect(result, "notifications").toHaveLength(1);
    expect(result[0], "notification").toMatchObject({
      title: UNKNOWN_TITLE,
      repository: notification.repository,
      number: 296,
      subject: notification.subject,
      context: notification.context,
      url: notification.url,
    });
  });

  it("applyDraftChecks treats a missing installation id as a failed lookup without calling it", async () => {
    const lookup = answering(NOT_A_DRAFT);

    const result = await applyDraftChecks([checked()], undefined, lookup);

    expect(result[0]?.title, "title").toBe(UNKNOWN_TITLE);
    expect(lookup, "lookup calls").not.toHaveBeenCalled();
  });

  it("applyDraftChecks passes a notification without a draft check through without a lookup", async () => {
    const lookup = answering(A_DRAFT);
    const notification = unchecked();

    const result = await applyDraftChecks([notification], INSTALLATION_ID, lookup);

    expect(result, "notifications").toEqual([notification]);
    expect(lookup, "lookup calls").not.toHaveBeenCalled();
  });

  it("applyDraftChecks keeps the order of the notifications and drops only the drafts", async () => {
    const first = unchecked();
    const draft = checked({ owner: "example-owner", repo: "example-other-repo", number: 1 });
    const last = checked({ owner: "example-owner", repo: "example-other-repo", number: 2 });
    const lookup = vi.fn<DraftLookup>((_installationId, pullRequest) =>
      Promise.resolve(pullRequest.number === 1 ? A_DRAFT : NOT_A_DRAFT),
    );

    const result = await applyDraftChecks([first, draft, last], INSTALLATION_ID, lookup);

    expect(result, "notifications").toEqual([first, last]);
  });

  it("applyDraftChecks answers an empty list for no notifications", async () => {
    const lookup = answering(NOT_A_DRAFT);

    const result = await applyDraftChecks([], INSTALLATION_ID, lookup);

    expect(result, "notifications").toEqual([]);
    expect(lookup, "lookup calls").not.toHaveBeenCalled();
  });
});
