/**
 * Stack400 lane s400-exports-idempotency — C-05 (route level) +
 * C-13.
 *
 * C-05: POST /music/export under a TRUE concurrent duplicate
 * submit. The item-64 guard was a lookup; migration 0331's partial
 * UNIQUE index on music_export_jobs (user_id, attempt_key) for
 * in-flight states now makes the loser's INSERT conflict, the store
 * returns the winner, and the route answers with the WINNER's job
 * id as the duplicate (before the fix the route answered with its
 * own freshly-minted id — a phantom job no row exists for). The
 * dedup SELECTs are delayed so both requests genuinely pass the
 * lookup before either inserts.
 *
 * C-13: POST /music/preview-render ran a full ffmpeg mix
 * SYNCHRONOUSLY with no limiter, no concurrency bound, no dedup —
 * parallel calls could stack renders on the API process. The route
 * now carries a per-user rate limiter (20/min) and an in-process
 * concurrency gate (1 per user, 3 global) that refuses honestly
 * (429 preview_busy / preview_rate_limited) before any render work.
 * Only auth, the render itself, and storage are mocked; the job
 * store is the real lib over pg-mem WITH the 0331 index.
 */
import { randomUUID } from "crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const USER_A = randomUUID();

const h = vi.hoisted(() => ({
  renders: 0,
  renderGate: null as Promise<void> | null,
  releaseRender: null as (() => void) | null,
  delayLookups: false,
}));

function sqlText(q: any): string {
  const parts: string[] = [];
  const walk = (node: any): void => {
    if (typeof node === "string") {
      parts.push(node);
      return;
    }
    if (!node || typeof node !== "object") return;
    if (typeof node.value === "string") parts.push(node.value);
    if (Array.isArray(node.value)) node.value.forEach(walk);
    if (Array.isArray(node.queryChunks)) node.queryChunks.forEach(walk);
  };
  walk(q);
  return parts.join(" ");
}

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = req.header("x-test-user") ?? USER_A;
    req.userCredits = 100_000;
    req.userSupabase = {};
    req.log = { error: () => {}, info: () => {}, warn: () => {} };
    next();
  },
}));

vi.mock("../../lib/audioExport", () => {
  class AudioExportError extends Error {
    code = "export_failed";
    status = 500;
    stderr = "";
  }
  return {
    AudioExportError,
    isAllowedStemUrl: () => true,
    isFfmpegAvailable: async () => true,
    selectStemsForExport: (stems: unknown[]) => stems,
    runMixExport: async () => {
      h.renders++;
      if (h.renderGate) await h.renderGate;
      return { buffer: Buffer.from("fake-mp3"), contentType: "audio/mpeg", ext: "mp3", warnings: [] };
    },
  };
});

vi.mock("../../lib/r2-client", () => ({
  r2Upload: async () => undefined,
  r2PublicUrl: (key: string) => `https://files.example/${key}`,
}));

import musicExportRouter from "../music-export";
import { __setMusicExportJobsDb } from "../../lib/music-export-jobs";
import { createTestDb, MUSIC_EXPORT_JOBS_DDL, type TestDb } from "../../lib/__tests__/test-db";
import { sql } from "drizzle-orm";

let server: any;
let baseUrl: string;
let td: TestDb;

const STEMS = [{ id: "s1", name: "Lead Vocal", type: "vocal", url: "https://cdn.example/lead.wav" }];
const EXPORT_BODY = { exportType: "full-mp3", stems: STEMS, masterVolume: 100 };
const PREVIEW_BODY = { stems: STEMS, masterVolume: 100, previewSeconds: 5 };

async function postExport(user: string) {
  const res = await fetch(`${baseUrl}/music/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-test-user": user },
    body: JSON.stringify(EXPORT_BODY),
  });
  return { status: res.status, json: (await res.json()) as any };
}

async function postPreview(user: string) {
  const res = await fetch(`${baseUrl}/music/preview-render`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-test-user": user },
    body: JSON.stringify(PREVIEW_BODY),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* the success path answers with the raw audio buffer */
  }
  return { status: res.status, json, text };
}

async function pollJob(user: string, jobId: string) {
  const res = await fetch(`${baseUrl}/music/export/job/${jobId}`, {
    headers: { "x-test-user": user },
  });
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}

async function pollUntilDone(user: string, jobId: string, timeoutMs = 8000): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { status, json } = await pollJob(user, jobId);
    expect(status).toBe(200);
    if (json.status === "done" || json.status === "failed") return json;
    if (Date.now() > deadline) throw new Error(`job ${jobId} never settled (last: ${json.status})`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

async function waitForRenders(n: number, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (h.renders < n) {
    if (Date.now() > deadline) throw new Error(`renders stuck at ${h.renders}, wanted ${n}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

function armRenderGate(): void {
  h.renderGate = new Promise<void>((resolve) => {
    h.releaseRender = resolve;
  });
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(musicExportRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(() => {
  td = createTestDb();
  td.mem.public.none(MUSIC_EXPORT_JOBS_DDL);
  td.mem.public.none(`
    CREATE UNIQUE INDEX music_export_jobs_active_attempt_uniq
      ON music_export_jobs (user_id, attempt_key)
      WHERE state IN ('queued', 'processing') AND attempt_key IS NOT NULL;
  `);
  /* Delay ONLY the dedup lookup's SELECT while armed, so the
     concurrent pair genuinely races past it (the claim UPDATE, the
     INSERT and the poll SELECT have different shapes). */
  const origExecute = td.db.execute.bind(td.db);
  (td.db as any).execute = async (q: any) => {
    const text = sqlText(q);
    if (h.delayLookups && /FROM music_export_jobs/.test(text) && /attempt_key =/.test(text)) {
      await new Promise((r) => setTimeout(r, 75));
    }
    return origExecute(q);
  };
  __setMusicExportJobsDb(td.db);
  h.renders = 0;
  h.renderGate = null;
  h.releaseRender = null;
  h.delayLookups = false;
});

afterEach(() => {
  __setMusicExportJobsDb(null);
});

describe("POST /music/export — C-05 concurrent duplicate submit", () => {
  it("two simultaneous identical POSTs return the same job and render once", async () => {
    armRenderGate();
    h.delayLookups = true;
    const [first, second] = await Promise.all([postExport(USER_A), postExport(USER_A)]);
    h.delayLookups = false;

    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(second.json.jobId).toBe(first.json.jobId);
    expect([first.json.duplicate, second.json.duplicate]).toContain(true);

    const rows = await td.db.execute(sql`SELECT id FROM music_export_jobs`);
    expect(rows.rows).toHaveLength(1);

    h.releaseRender!();
    const done = await pollUntilDone(USER_A, first.json.jobId);
    expect(done.status).toBe("done");
    expect(h.renders).toBe(1);
  });
});

describe("POST /music/preview-render — C-13 door", () => {
  it("a second concurrent preview for the same user is refused (429 preview_busy), and the slot frees after", async () => {
    const user = randomUUID();
    armRenderGate();
    const first = postPreview(user);
    await waitForRenders(1);

    const blocked = await postPreview(user);
    expect(blocked.status).toBe(429);
    expect(blocked.json?.code).toBe("preview_busy");

    h.releaseRender!();
    expect((await first).status).toBe(200);

    /* The gate released — the same user can preview again. */
    const after = await postPreview(user);
    expect(after.status).toBe(200);
    expect(h.renders).toBe(2);
  });

  it("the global cap refuses a fourth concurrent preview across users", async () => {
    const users = [randomUUID(), randomUUID(), randomUUID()];
    armRenderGate();
    const pending = users.map((u) => postPreview(u));
    await waitForRenders(3);

    const blocked = await postPreview(randomUUID());
    expect(blocked.status).toBe(429);
    expect(blocked.json?.code).toBe("preview_busy");

    h.releaseRender!();
    const results = await Promise.all(pending);
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
  });

  it("the per-user rate limiter refuses the 21st preview inside a minute", async () => {
    const user = randomUUID();
    for (let i = 0; i < 20; i++) {
      const res = await postPreview(user);
      expect(res.status).toBe(200);
    }
    const blocked = await postPreview(user);
    expect(blocked.status).toBe(429);
    expect(blocked.json?.code).toBe("preview_rate_limited");
    expect(h.renders).toBe(20);
  });
});
