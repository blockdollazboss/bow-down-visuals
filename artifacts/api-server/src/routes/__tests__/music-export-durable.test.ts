/**
 * Stack300 export-reliability items 62/63/64 — POST /music/export and
 * GET /music/export/job/:id over real HTTP.
 *
 * Before the fix: jobs lived in a process Map (a restart erased them),
 * the job record stored no userId and the poll endpoint returned the
 * finished export — including its file URL — to ANY signed-in caller,
 * and a duplicate start POST rendered the same mix twice. Now the job
 * is a durable row, the poll 404s for anyone but the owner, and a
 * duplicate POST returns the in-flight job. Only auth, the render
 * itself, and storage are mocked; the job store is the real lib over
 * pg-mem.
 */
import { randomUUID } from "crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const USER_A = randomUUID();
const USER_B = randomUUID();

const h = vi.hoisted(() => ({
  renders: 0,
  renderGate: null as Promise<void> | null,
  releaseRender: null as (() => void) | null,
}));

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
import { createTestDb, MUSIC_EXPORT_JOBS_DDL } from "../../lib/__tests__/test-db";

let server: any;
let baseUrl: string;

const STEMS = [{ id: "s1", name: "Lead Vocal", type: "vocal", url: "https://cdn.example/lead.wav" }];
const BODY = { exportType: "full-mp3", stems: STEMS, masterVolume: 100 };

async function postExport(user: string, body: unknown = BODY) {
  const res = await fetch(`${baseUrl}/music/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-test-user": user },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as any };
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
  const td = createTestDb();
  td.mem.public.none(MUSIC_EXPORT_JOBS_DDL);
  __setMusicExportJobsDb(td.db);
  h.renders = 0;
  h.renderGate = null;
  h.releaseRender = null;
});

afterEach(() => {
  __setMusicExportJobsDb(null);
});

describe("POST /music/export — durable jobs (item 62)", () => {
  it("runs to done on the durable row and the owner polls the result URL", async () => {
    const { status, json } = await postExport(USER_A);
    expect(status).toBe(202);
    expect(json.status).toBe("queued");
    const done = await pollUntilDone(USER_A, json.jobId);
    expect(done.status).toBe("done");
    expect(done.result.url).toContain("https://files.example/");
    expect(done.result.format).toBe("mp3");
    expect(h.renders).toBe(1);
  });
});

describe("GET /music/export/job/:id — ownership (item 63)", () => {
  it("404s for any signed-in user who is not the owner", async () => {
    const { json } = await postExport(USER_A);
    const asOther = await pollJob(USER_B, json.jobId);
    expect(asOther.status).toBe(404);
    expect(asOther.json?.code).toBe("job_not_found");
    // The owner's own poll is unaffected.
    const asOwner = await pollJob(USER_A, json.jobId);
    expect(asOwner.status).toBe(200);
  });

  it("404s for a job id that does not exist", async () => {
    const res = await pollJob(USER_A, randomUUID());
    expect(res.status).toBe(404);
  });
});

describe("POST /music/export — duplicate-submit guard (item 64)", () => {
  it("a second identical POST returns the in-flight job — one render, not two", async () => {
    h.renderGate = new Promise<void>((resolve) => {
      h.releaseRender = resolve;
    });
    const first = await postExport(USER_A);
    expect(first.status).toBe(202);

    const second = await postExport(USER_A);
    expect(second.status).toBe(202);
    expect(second.json.jobId).toBe(first.json.jobId);
    expect(second.json.duplicate).toBe(true);

    h.releaseRender!();
    const done = await pollUntilDone(USER_A, first.json.jobId);
    expect(done.status).toBe("done");
    expect(h.renders).toBe(1);
  });

  it("a different user posting the same mix gets their own job", async () => {
    h.renderGate = new Promise<void>((resolve) => {
      h.releaseRender = resolve;
    });
    const first = await postExport(USER_A);
    const other = await postExport(USER_B);
    expect(other.json.jobId).not.toBe(first.json.jobId);
    expect(other.json.duplicate).toBeUndefined();
    h.releaseRender!();
    await pollUntilDone(USER_A, first.json.jobId);
    await pollUntilDone(USER_B, other.json.jobId);
    expect(h.renders).toBe(2);
  });
});
