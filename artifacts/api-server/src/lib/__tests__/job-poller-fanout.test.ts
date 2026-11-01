/**
 * Fan-out truth (stack1100 Y3): a lip-sync job's terminal outcome must
 * reach the paying member — bell + category-gated device ping through
 * notifyUserEvent — not only the job_notifications relay row. The door
 * event rides the row's own exactly-once landing: a replayed outcome
 * for the same job fires nothing twice.
 */
import { randomUUID } from "crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __setLipSyncEventNotifier,
  recordLipSyncOutcome,
} from "../job-poller";
import { __setJobNotificationsDb, listPendingNotifications } from "../job-notifications";
import type { UserEventInput } from "../push-events";
import type { LipSyncJob } from "../lip-sync-jobs";
import { createTestDb } from "./test-db";

const events: UserEventInput[] = [];

function fakeJob(over: Partial<LipSyncJob> = {}): LipSyncJob {
  return {
    id: randomUUID(),
    userId: randomUUID(),
    projectId: randomUUID(),
    ...over,
  } as LipSyncJob;
}

beforeEach(() => {
  const { db } = createTestDb();
  __setJobNotificationsDb(db);
  events.length = 0;
  __setLipSyncEventNotifier(async (input) => {
    events.push(input);
  });
});

afterEach(() => {
  __setLipSyncEventNotifier(null);
  __setJobNotificationsDb(null);
});

describe("recordLipSyncOutcome fan-out", () => {
  it("a landed failure records the relay row AND fires one money event to the job owner", async () => {
    const job = fakeJob();
    await recordLipSyncOutcome(job, "failed", "Lip sync failed", "Provider said no.");
    expect(await listPendingNotifications()).toHaveLength(1);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      userId: job.userId,
      category: "money",
      kind: "lip_sync_failed",
      title: "Lip sync failed",
      body: "Provider said no.",
      link: `/video-editor?project=${job.projectId}`,
    });
  });

  it("a replayed outcome for the same job fires nothing twice", async () => {
    const job = fakeJob();
    await recordLipSyncOutcome(job, "failed", "Lip sync failed", "Provider said no.");
    await recordLipSyncOutcome(job, "failed", "Lip sync failed", "Provider said no.");
    expect(await listPendingNotifications()).toHaveLength(1);
    expect(events).toHaveLength(1);
  });

  it("completion fires lip_sync_done; a project-less job links to history", async () => {
    const job = fakeJob({ projectId: null });
    await recordLipSyncOutcome(job, "completed", "Lip sync ready", "Your lip-synced scene is ready (5.0s).");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "lip_sync_done",
      category: "money",
      link: "/my-projects?tab=history",
    });
  });
});
