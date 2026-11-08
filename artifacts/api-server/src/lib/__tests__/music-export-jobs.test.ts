/**
 * Stack300 export-reliability items 62/63/64 — the durable music
 * (mix) export job store.
 *
 * Before the fix, mix-export jobs lived in a process Map: a restart
 * killed every in-flight render, the job record carried no userId
 * (so the poll endpoint could not check ownership), and a duplicate
 * start POST rendered twice. These tests drive the real store
 * against pg-mem: create/claim/complete semantics, the attempt-key
 * dedup lookup, and boot recovery (re-run under the attempt cap,
 * honest failure at the cap).
 */
import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __setMusicExportJobsDb,
  claimMusicExportJob,
  completeMusicExportJob,
  createMusicExportJob,
  failMusicExportJob,
  findActiveMusicExportJobByAttemptKey,
  getMusicExportJob,
  recoverInterruptedMusicExportJobs,
} from "../music-export-jobs";
import { createTestDb, MUSIC_EXPORT_JOBS_DDL, type TestDb } from "./test-db";

let td: TestDb;
const USER = randomUUID();
const OTHER = randomUUID();

beforeEach(() => {
  td = createTestDb();
  td.mem.public.none(MUSIC_EXPORT_JOBS_DDL);
  __setMusicExportJobsDb(td.db);
});

afterEach(() => {
  __setMusicExportJobsDb(null);
});

const PARAMS = { stems: [{ name: "Lead" }], masterVolume: 100, format: "mp3" };

describe("music export job store (item 62 — durability)", () => {
  it("creates a queued job carrying its owner and params", async () => {
    const id = randomUUID();
    const job = await createMusicExportJob(id, USER, PARAMS, "key-1");
    expect(job.id).toBe(id);
    expect(job.userId).toBe(USER);
    expect(job.state).toBe("queued");
    expect(job.attemptKey).toBe("key-1");

    const read = await getMusicExportJob(id);
    expect(read?.userId).toBe(USER);
    expect(read?.params).toEqual(PARAMS);
  });

  it("claims exactly once — the loser of a route/recovery race gets nothing", async () => {
    const id = randomUUID();
    await createMusicExportJob(id, USER, PARAMS, null);
    const first = await claimMusicExportJob(id);
    expect(first?.state).toBe("processing");
    expect(first?.attempts).toBe(1);
    expect(await claimMusicExportJob(id)).toBeUndefined();
  });

  it("completes and fails through state-guarded transitions", async () => {
    const id = randomUUID();
    await createMusicExportJob(id, USER, PARAMS, null);
    await claimMusicExportJob(id);
    await completeMusicExportJob(id, { url: "https://files.example/mix.mp3" });
    const done = await getMusicExportJob(id);
    expect(done?.state).toBe("done");
    expect(done?.result).toEqual({ url: "https://files.example/mix.mp3" });
    // A late failure can never clobber a terminal state.
    await failMusicExportJob(id, "late error", "export_failed");
    expect((await getMusicExportJob(id))?.state).toBe("done");
  });
});

describe("attempt-key dedup lookup (item 64)", () => {
  it("finds the in-flight job for its owner — and no one else", async () => {
    const id = randomUUID();
    await createMusicExportJob(id, USER, PARAMS, "dup-key");
    expect((await findActiveMusicExportJobByAttemptKey(USER, "dup-key"))?.id).toBe(id);
    expect(await findActiveMusicExportJobByAttemptKey(OTHER, "dup-key")).toBeUndefined();
    expect(await findActiveMusicExportJobByAttemptKey(USER, "other-key")).toBeUndefined();
  });

  it("stops matching once the job is terminal — a fresh export may start", async () => {
    const id = randomUUID();
    await createMusicExportJob(id, USER, PARAMS, "dup-key");
    await claimMusicExportJob(id);
    await completeMusicExportJob(id, { url: "https://files.example/mix.mp3" });
    expect(await findActiveMusicExportJobByAttemptKey(USER, "dup-key")).toBeUndefined();
  });
});

describe("boot recovery (item 62 — restart survival)", () => {
  it("re-queues an interrupted job and hands it back for a re-run", async () => {
    const id = randomUUID();
    await createMusicExportJob(id, USER, PARAMS, null);
    await claimMusicExportJob(id); // processing, attempts = 1 — then the process "dies"

    const recovered: string[] = [];
    await recoverInterruptedMusicExportJobs(async (job) => {
      recovered.push(job.id);
    });
    expect(recovered).toEqual([id]);
    expect((await getMusicExportJob(id))?.state).toBe("queued");
    // And it is claimable again — the re-run can actually start.
    expect((await claimMusicExportJob(id))?.attempts).toBe(2);
  });

  it("fails a poison job honestly at the attempt cap instead of looping", async () => {
    const id = randomUUID();
    await createMusicExportJob(id, USER, PARAMS, null);
    // Burn all 3 attempts: claim, then (as a crash + recovery cycle
    // would) leave the row for the next boot.
    for (let i = 0; i < 3; i++) {
      expect(await claimMusicExportJob(id)).toBeDefined();
      await td.db.execute(sql`UPDATE music_export_jobs SET state = 'queued' WHERE id = ${id}`);
    }
    // One more claim leaves it processing with attempts = 4 — past
    // the cap when the next restart strands it.
    await claimMusicExportJob(id);

    const recovered: string[] = [];
    await recoverInterruptedMusicExportJobs(async (job) => {
      recovered.push(job.id);
    });
    expect(recovered).toEqual([]);
    const job = await getMusicExportJob(id);
    expect(job?.state).toBe("failed");
    expect(job?.code).toBe("interrupted");
    expect(job?.error).toContain("you were not charged");
  });

  it("leaves terminal jobs untouched", async () => {
    const id = randomUUID();
    await createMusicExportJob(id, USER, PARAMS, null);
    await completeMusicExportJob(id, { url: "https://files.example/mix.mp3" });
    const recovered: string[] = [];
    await recoverInterruptedMusicExportJobs(async (job) => {
      recovered.push(job.id);
    });
    expect(recovered).toEqual([]);
    expect((await getMusicExportJob(id))?.state).toBe("done");
  });
});
