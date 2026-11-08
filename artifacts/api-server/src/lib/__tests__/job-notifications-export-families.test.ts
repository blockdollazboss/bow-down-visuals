/**
 * Stack300 item 73 — music-export and multi-ratio job endings notify.
 *
 * Before the fix, the terminal-notification backfill scanned only
 * export_jobs: a user who closed the tab during a minutes-long mix or
 * multi-ratio render got no bell and no push on completion OR failure,
 * unlike video export and lip-sync. These tests seed terminal rows for
 * both families in pg-mem and drive the two new backfills: exactly one
 * notification per job (the UNIQUE gate), the right titles/messages,
 * the media link on completions, and the push event on the same
 * exactly-once landing.
 */
import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __setExportEventNotifier,
  __setJobNotificationsDb,
  listPendingNotifications,
  notifyTerminalMultiRatioJobs,
  notifyTerminalMusicExportJobs,
} from "../job-notifications";
import {
  createTestDb,
  MULTI_RATIO_JOBS_DDL,
  MUSIC_EXPORT_JOBS_DDL,
  type TestDb,
} from "./test-db";

let td: TestDb;
const USER = randomUUID();
const pushEvents: Array<Record<string, unknown>> = [];

beforeEach(() => {
  td = createTestDb();
  td.mem.public.none(MUSIC_EXPORT_JOBS_DDL);
  td.mem.public.none(MULTI_RATIO_JOBS_DDL);
  __setJobNotificationsDb(td.db);
  pushEvents.length = 0;
  __setExportEventNotifier(async (input) => {
    pushEvents.push(input as unknown as Record<string, unknown>);
  });
});

afterEach(() => {
  __setJobNotificationsDb(null);
  __setExportEventNotifier(null);
});

async function seedMusicJob(state: "done" | "failed", opts: { error?: string } = {}): Promise<string> {
  const id = randomUUID();
  await td.db.execute(sql`
    INSERT INTO music_export_jobs (id, user_id, state, params, result, error)
    VALUES (${id}, ${USER}, ${state}, ${JSON.stringify({})}::jsonb,
            ${state === "done" ? JSON.stringify({ url: "https://files.example/mix.mp3", format: "mp3" }) : null}::jsonb,
            ${opts.error ?? null})
  `);
  return id;
}

async function seedMultiRatioJob(state: "done" | "failed", opts: { error?: string } = {}): Promise<string> {
  const id = randomUUID();
  const ratios =
    state === "done"
      ? [{ ratio: "1:1", state: "done", progress: 100, url: "https://signed.example/out.mp4" }]
      : [{ ratio: "1:1", state: "failed", progress: 0, error: "Render failed." }];
  await td.db.execute(sql`
    INSERT INTO multi_ratio_jobs (id, user_id, video_url, cost_total, cost_per_ratio, ratios, state, error)
    VALUES (${id}, ${USER}, 'https://source.example/v.mp4', 100, 100,
            ${JSON.stringify(ratios)}::jsonb, ${state}, ${opts.error ?? null})
  `);
  return id;
}

describe("notifyTerminalMusicExportJobs (item 73)", () => {
  it("notifies a finished mix once — bell row with the file link + one push event", async () => {
    const id = await seedMusicJob("done");
    expect(await notifyTerminalMusicExportJobs()).toBe(1);

    const pending = await listPendingNotifications();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      jobType: "music_export",
      jobId: id,
      userId: USER,
      status: "completed",
      title: "Music export ready",
      videoUrl: "https://files.example/mix.mp3",
    });
    expect(pushEvents).toHaveLength(1);
    expect(pushEvents[0]).toMatchObject({ kind: "music_export_done", userId: USER });

    // Exactly-once: a second backfill pass creates nothing new.
    expect(await notifyTerminalMusicExportJobs()).toBe(0);
    expect(await listPendingNotifications()).toHaveLength(1);
    expect(pushEvents).toHaveLength(1);
  });

  it("notifies a failed mix with its honest error", async () => {
    await seedMusicJob("failed", { error: "Audio export failed." });
    expect(await notifyTerminalMusicExportJobs()).toBe(1);
    const pending = await listPendingNotifications();
    expect(pending[0]).toMatchObject({
      jobType: "music_export",
      status: "failed",
      title: "Music export failed",
      message: "Audio export failed.",
    });
    expect(pushEvents[0]).toMatchObject({ kind: "music_export_failed" });
  });

  it("ignores jobs still in flight", async () => {
    const id = randomUUID();
    await td.db.execute(sql`
      INSERT INTO music_export_jobs (id, user_id, state, params)
      VALUES (${id}, ${USER}, 'processing', ${JSON.stringify({})}::jsonb)
    `);
    expect(await notifyTerminalMusicExportJobs()).toBe(0);
    expect(await listPendingNotifications()).toHaveLength(0);
  });
});

describe("notifyTerminalMultiRatioJobs (item 73)", () => {
  it("notifies a finished multi-ratio export once, linking the first finished ratio", async () => {
    const id = await seedMultiRatioJob("done");
    expect(await notifyTerminalMultiRatioJobs()).toBe(1);
    const pending = await listPendingNotifications();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      jobType: "multi_ratio",
      jobId: id,
      status: "completed",
      title: "Multi-ratio export ready",
      videoUrl: "https://signed.example/out.mp4",
    });
    expect(pushEvents[0]).toMatchObject({ kind: "multi_ratio_done" });
    expect(await notifyTerminalMultiRatioJobs()).toBe(0);
  });

  it("translates the restart token into the honest refund sentence", async () => {
    await seedMultiRatioJob("failed", { error: "interrupted_by_restart" });
    expect(await notifyTerminalMultiRatioJobs()).toBe(1);
    const pending = await listPendingNotifications();
    expect(pending[0]).toMatchObject({ jobType: "multi_ratio", status: "failed", title: "Multi-ratio export failed" });
    expect(pending[0]!.message).toContain("interrupted by a server restart");
    expect(pending[0]!.message).toContain("refunded");
    expect(pending[0]!.message).not.toContain("interrupted_by_restart");
  });
});
