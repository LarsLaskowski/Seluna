import { digestNotification } from "./digest";
import { deliverMessages } from "./delivery";
import type { DeliveryDeps, PendingMessage } from "./delivery";
import { isDigestDue } from "./digest-schedule";
import { renderTelegramText } from "./message";
import { ACTIVITY_RETENTION_MS, countedActivityDelete, oldActivityDelete, readDigestSummary } from "./store/activity";
import { digestRunUpsert, readDigestRun } from "./store/meta";
import { outboxInsert } from "./store/outbox";
import { readNotificationSettings } from "./store/settings";

/** What a digest run did. `store-failed` stores no run time, so the next run evaluates again. */
export type DigestJobResult = "sent" | "queued" | "nothing-due" | "empty" | "off" | "store-failed";

/** The most `activity` rows a run that is not due deletes for being older than the retention. */
const OLD_ROWS_PER_RUN = 1000;

/** Commits the digest row, the delete of the counted rows and the run time in one batch; returns the new row's id. */
async function commitDigest(
  deps: DeliveryDeps,
  startedAt: Date,
  maxId: number,
  row: Parameters<typeof outboxInsert>[1],
): Promise<number> {
  const results: D1Result<Record<string, unknown>>[] = await deps.db.batch([
    outboxInsert(deps.db, row, startedAt),
    countedActivityDelete(deps.db, maxId),
    digestRunUpsert(deps.db, startedAt),
  ]);
  const id: unknown = results[0]?.results[0]?.id;
  if (typeof id !== "number") {
    throw new TypeError("The outbox insert returned no id");
  }
  return id;
}

async function runDigest(startedAt: Date, deps: DeliveryDeps, sendNow: boolean): Promise<DigestJobResult> {
  const settings = await readNotificationSettings(deps.db);
  if (!settings.rules.repository_starred && !settings.rules.repository_forked) {
    await digestRunUpsert(deps.db, startedAt).run();
    return "off";
  }
  const previousRun = await readDigestRun(deps.db);
  if (previousRun === undefined) {
    await digestRunUpsert(deps.db, startedAt).run();
    return "nothing-due";
  }
  const notBefore = new Date(startedAt.getTime() - ACTIVITY_RETENTION_MS);
  if (!isDigestDue(settings.activityDigest, settings.timeZone, previousRun, startedAt)) {
    await deps.db.batch([oldActivityDelete(deps.db, notBefore, OLD_ROWS_PER_RUN), digestRunUpsert(deps.db, startedAt)]);
    return "nothing-due";
  }
  const summary = await readDigestSummary(deps.db, notBefore);
  if (summary === undefined) {
    await digestRunUpsert(deps.db, startedAt).run();
    return "empty";
  }
  if (summary.repositories.length === 0) {
    await deps.db.batch([countedActivityDelete(deps.db, summary.maxId), digestRunUpsert(deps.db, startedAt)]);
    return "empty";
  }
  const { notification, buttonUrl } = digestNotification(summary, settings.language);
  const row = { notification, buttonUrl, silent: false };
  const id = await commitDigest(deps, startedAt, summary.maxId, row);
  if (!sendNow) {
    return "queued";
  }
  const pending: PendingMessage = {
    id,
    text: renderTelegramText(notification),
    buttonUrl,
    silent: false,
    notification,
  };
  await deliverMessages([pending], settings, deps);
  return "sent";
}

/**
 * Builds and commits the activity digest when it is due. With `sendNow` the digest row is sent in this run,
 * otherwise it stays pending for the next retry. Never rejects.
 */
export async function runActivityDigest(
  startedAt: Date,
  deps: DeliveryDeps,
  sendNow: boolean,
): Promise<DigestJobResult> {
  try {
    return await runDigest(startedAt, deps, sendNow);
  } catch {
    // The error is dropped: only the fixed result reaches the log.
    return "store-failed";
  }
}
