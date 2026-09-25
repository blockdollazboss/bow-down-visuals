/**
 * $0 verification suite for the exactly-once notification gate.
 *
 * UNIQUE(job_type, job_id) + INSERT … ON CONFLICT DO NOTHING means a job can
 * never produce a second ping, and the delivered_at flip is atomic so two
 * relays racing the same row still yield exactly one user-facing ping.
 */
import { randomUUID } from "crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __setJobNotificationsDb,
  ackJobNotification,
  createJobNotification,
  listPendingNotifications,
} from "../job-notifications";
import { createTestDb } from "./test-db";

beforeEach(() => {
  __setJobNotificationsDb(createTestDb().db);
});

afterEach(() => {
  __setJobNotificationsDb(null);
});

function notif(jobId: string) {
  return {
    jobType: "lip_sync" as const,
    jobId,
    userId: randomUUID(),
    status: "completed" as const,
    title: "Lip sync ready",
    message: "done",
  };
}

describe("createJobNotification", () => {
  it("records the first notification and reports created=true", async () => {
    const created = await createJobNotification(notif("job-1"));
    expect(created).toBe(true);
    const pending = await listPendingNotifications();
    expect(pending).toHaveLength(1);
    expect(pending[0].jobId).toBe("job-1");
  });

  it("a second notification for the same job is a no-op — exactly once", async () => {
    const jobId = randomUUID();
    expect(await createJobNotification(notif(jobId))).toBe(true);
    expect(await createJobNotification(notif(jobId))).toBe(false);
    expect(await createJobNotification(notif(jobId))).toBe(false);
    expect(await listPendingNotifications()).toHaveLength(1);
  });

  it("different jobs each get their own notification", async () => {
    expect(await createJobNotification(notif("job-a"))).toBe(true);
    expect(await createJobNotification(notif("job-b"))).toBe(true);
    expect(await listPendingNotifications()).toHaveLength(2);
  });

  it("same job id under a different job type is a separate notification", async () => {
    const jobId = randomUUID();
    expect(await createJobNotification(notif(jobId))).toBe(true);
    expect(
      await createJobNotification({ ...notif(jobId), jobType: "export" }),
    ).toBe(true);
  });
});

describe("ackJobNotification", () => {
  it("two relays racing the ack produce exactly one winner", async () => {
    const jobId = randomUUID();
    await createJobNotification(notif(jobId));
    const [id] = (await listPendingNotifications()).map((n) => n.id);
    const [a, b] = await Promise.all([
      ackJobNotification(id, "relay"),
      ackJobNotification(id, "relay"),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(await listPendingNotifications()).toHaveLength(0);
  });

  it("acking a missing id returns false", async () => {
    expect(await ackJobNotification(randomUUID(), "relay")).toBe(false);
  });
});
