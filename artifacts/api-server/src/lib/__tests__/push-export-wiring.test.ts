/**
 * Export terminal → device-push wiring (stack600, on the Stack500 push
 * foundation). Exports are the spec's wiring-order #2, category "money"
 * (the paid-work rail; no "work" category exists).
 *
 * The chain proven here, end to end on an in-memory Postgres:
 *   export_jobs row reaches done/failed
 *     → notifyTerminalExportJobs backfill (the poller's terminal hook)
 *       → createJobNotification lands the exactly-once job_notifications
 *         row (UNIQUE(job_type, job_id) — the same gate the shop-sale
 *         wiring mirrors)
 *         → ONLY on that landing, notifyUserEvent fires: bell always,
 *           device ping only when the user's "money" category is on.
 *
 * Recovery safety: an interrupted job is non-terminal while boot
 * recovery re-runs it, so no event exists until it truly finishes —
 * and re-scans after the landing can never fire a second one.
 */
import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __setExportEventNotifier,
  __setJobNotificationsDb,
  listPendingNotifications,
  notifyTerminalExportJobs,
} from "../job-notifications";
import {
  notifyUserEvent,
  PUSH_CATEGORY_DEFAULTS,
  type NotifyDeps,
  type PushPreferenceMap,
  type UserEventInput,
  type UserEventResult,
} from "../push-events";
import { createTestDb, EXPORT_JOBS_DDL, type TestDb } from "./test-db";

let td: TestDb;
let events: UserEventInput[];
let results: UserEventResult[];
let bells: UserEventInput[];
let pushes: Array<{ userId: string; payload: unknown }>;
let prefs: PushPreferenceMap;

/** The injected notifier IS the real event service, with fake legs —
    so these tests prove the production composition, not a stub of it. */
function installRealNotifierWithFakeLegs() {
  const deps: NotifyDeps = {
    getPrefs: async () => prefs,
    insertBell: async (input) => {
      bells.push(input);
    },
    sendPush: async (userId, payload) => {
      pushes.push({ userId, payload });
      return { sent: 1, pruned: 0, failed: 0, skippedReason: null };
    },
  };
  __setExportEventNotifier(async (input) => {
    events.push(input);
    const result = await notifyUserEvent(input, deps);
    results.push(result);
    return result;
  });
}

async function insertExportJob(opts: {
  state: string;
  result?: Record<string, unknown> | null;
  error?: Record<string, unknown> | null;
  projectId?: string | null;
}): Promise<{ jobId: string; userId: string; projectId: string }> {
  const jobId = randomUUID();
  const userId = randomUUID();
  const projectId = opts.projectId === undefined ? randomUUID() : opts.projectId;
  await td.db.execute(sql`
    INSERT INTO export_jobs (id, user_id, project_id, state, result, error)
    VALUES (
      ${jobId},
      ${userId},
      ${projectId},
      ${opts.state},
      ${opts.result ? JSON.stringify(opts.result) : null}::jsonb,
      ${opts.error ? JSON.stringify(opts.error) : null}::jsonb
    )
  `);
  return { jobId, userId, projectId: projectId ?? "" };
}

async function setJobState(jobId: string, state: string) {
  await td.db.execute(sql`
    UPDATE export_jobs SET state = ${state}, updated_at = now() WHERE id = ${jobId}
  `);
}

beforeEach(() => {
  td = createTestDb();
  td.mem.public.none(EXPORT_JOBS_DDL);
  __setJobNotificationsDb(td.db);
  process.env["JOB_NOTIFY_CHANNEL"] = "relay";
  events = [];
  results = [];
  bells = [];
  pushes = [];
  prefs = { ...PUSH_CATEGORY_DEFAULTS };
  installRealNotifierWithFakeLegs();
});

afterEach(() => {
  __setExportEventNotifier(null);
  __setJobNotificationsDb(null);
});

describe("export completion → push event", () => {
  it("fires exactly once: bell + ping, money category, project deep link", async () => {
    const { userId, projectId } = await insertExportJob({
      state: "done",
      result: { url: "https://cdn.example.com/final.mp4" },
    });

    expect(await notifyTerminalExportJobs()).toBe(1);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      userId,
      category: "money",
      kind: "export_done",
      title: "Export ready",
      link: `/video-editor?project=${projectId}`,
    });
    expect(events[0].body).toContain("download");
    // Bell always lands; ping fires because money defaults on.
    expect(bells).toHaveLength(1);
    expect(pushes).toHaveLength(1);
    expect(results[0].pushSkippedReason).toBeNull();
    // The exactly-once job rail row landed too.
    const pending = await listPendingNotifications();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ jobType: "export", status: "completed" });

    // A second poller tick (re-scan) must never re-fire.
    expect(await notifyTerminalExportJobs()).toBe(0);
    expect(events).toHaveLength(1);
    expect(bells).toHaveLength(1);
    expect(pushes).toHaveLength(1);
  });
});

describe("export failure → push event", () => {
  it("fires exactly once with the honest failure reason as the body", async () => {
    const reason =
      "Prepare session expired or not found (likely the server restarted or 30+ minutes passed since preparing).";
    await insertExportJob({ state: "failed", error: { message: reason, code: "PREPARE_STALE" } });

    expect(await notifyTerminalExportJobs()).toBe(1);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      category: "money",
      kind: "export_failed",
      title: "Export failed",
      body: reason,
    });
    expect(bells).toHaveLength(1);
    expect(pushes).toHaveLength(1);
    const pending = await listPendingNotifications();
    expect(pending[0]).toMatchObject({ jobType: "export", status: "failed", message: reason });

    expect(await notifyTerminalExportJobs()).toBe(0);
    expect(events).toHaveLength(1);
  });
});

describe("recovery re-run", () => {
  it("an interrupted job fires nothing mid-recovery, then exactly one completion", async () => {
    const { jobId } = await insertExportJob({ state: "active" });

    // Boot recovery re-queued the job; it is non-terminal — no event.
    expect(await notifyTerminalExportJobs()).toBe(0);
    expect(events).toHaveLength(0);

    // The re-run finishes the render.
    await setJobState(jobId, "done");
    expect(await notifyTerminalExportJobs()).toBe(1);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("export_done");

    // Later ticks / a second recovery pass can never double-fire.
    expect(await notifyTerminalExportJobs()).toBe(0);
    expect(events).toHaveLength(1);
    expect(pushes).toHaveLength(1);
  });

  it("a recovered job that ends failed fires exactly one failure event", async () => {
    const { jobId } = await insertExportJob({ state: "active" });
    expect(await notifyTerminalExportJobs()).toBe(0);

    await setJobState(jobId, "failed");
    await td.db.execute(sql`
      UPDATE export_jobs SET error = ${JSON.stringify({ message: "Render died twice." })}::jsonb WHERE id = ${jobId}
    `);
    expect(await notifyTerminalExportJobs()).toBe(1);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "export_failed", body: "Render died twice." });
    expect(await notifyTerminalExportJobs()).toBe(0);
    expect(events).toHaveLength(1);
  });
});

describe("preference gating", () => {
  it("money off suppresses the ping but never the bell", async () => {
    prefs = { ...PUSH_CATEGORY_DEFAULTS, money: false };
    await insertExportJob({ state: "done", result: { url: "https://cdn.example.com/f.mp4" } });

    expect(await notifyTerminalExportJobs()).toBe(1);

    expect(events).toHaveLength(1);
    expect(bells).toHaveLength(1);
    expect(pushes).toHaveLength(0);
    expect(results[0].bellLanded).toBe(true);
    expect(results[0].push).toBeNull();
    expect(results[0].pushSkippedReason).toBe("category_off");
  });
});
