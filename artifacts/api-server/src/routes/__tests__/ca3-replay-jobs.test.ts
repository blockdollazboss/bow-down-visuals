/**
 * CA-3 (charge-audit batch B3) — EXPOSED-REPLAY fixes, Pattern B
 * job rails + the ffmpeg family failure path.
 *
 * Pattern B (LUFS normalize, lyric-video render): the stored result
 * is the 202 job-creation body carrying the jobId. A replay returns
 * the SAME jobId with replayed:true — no second charge, no second
 * job. When the job later fails, it refunds and VOIDS its charge
 * key and drops the stored body, so a retry charges fresh and mints
 * a NEW job. The stored body is only served while its job is still
 * tracked and not failed (the job-alive gate).
 *
 * Karaoke stands in for the ffmpeg family (karaoke / intro-outro /
 * logo-animator / loop-maker share the identical scaffold): its
 * provider work cannot succeed on a fake download, so the test pins
 * the failure contract — refund + VOID + the retry charges fresh.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const USER = "user-1";

const h = vi.hoisted(() => ({
  balance: 100_000,
  charges: [] as Array<{ amount: number; key: string }>,
  refunds: [] as number[],
  voids: [] as string[],
  chargedKeys: new Set<string>(),
  stored: new Map<string, { userId: string; rail: string; result: any }>(),
  audioFetchMode: "ok" as "ok" | "fail",
}));

function keyFromCondition(cond: unknown): string | null {
  const walk = (node: unknown, depth: number): string | null => {
    if (node === null || typeof node !== "object" || depth > 6) return null;
    if ((node as { constructor?: { name?: string } }).constructor?.name === "Param") {
      const v = (node as { value?: unknown }).value;
      return typeof v === "string" ? v : null;
    }
    if (Array.isArray(node)) {
      for (const child of node) {
        const hit = walk(child, depth + 1);
        if (hit !== null) return hit;
      }
      return null;
    }
    const chunks = (node as { queryChunks?: unknown }).queryChunks;
    return Array.isArray(chunks) ? walk(chunks, depth + 1) : null;
  };
  return walk(cond, 0);
}

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = USER;
    req.userCredits = h.balance;
    req.log = { info() {}, error() {}, warn() {} };
    next();
  },
}));

vi.mock("../../lib/credits", () => {
  class OutOfCreditsError extends Error { readonly code = "OUT_OF_CREDITS"; }
  class LedgerWriteError extends Error { readonly code = "LEDGER_WRITE"; }
  return {
    OutOfCreditsError,
    LedgerWriteError,
    buildChargeIdempotencyKey: (scope: string, userId: string, clientKey: unknown, intent: unknown) =>
      typeof clientKey === "string" && clientKey.trim().length >= 8
        ? `${scope}:${userId}:client:${clientKey.trim()}`
        : `${scope}:${userId}:${JSON.stringify(intent)}`,
    chargeCredits: async (_userId: string, amount: number, _meta: unknown, opts?: { idempotencyKey?: string | null }) => {
      const key = opts?.idempotencyKey ?? "";
      if (key && h.chargedKeys.has(key)) return h.balance;
      if (h.balance < amount) throw new OutOfCreditsError("out");
      h.balance -= amount;
      if (key) h.chargedKeys.add(key);
      h.charges.push({ amount, key });
      return h.balance;
    },
    refundCredits: async (_userId: string, amount: number) => {
      h.balance += amount;
      h.refunds.push(amount);
      return h.balance;
    },
    voidChargeIdempotencyKey: async (key: string) => {
      h.voids.push(key);
      return h.chargedKeys.delete(key);
    },
  };
});

vi.mock("../../lib/objectStorage", () => ({
  uploadMediaToSupabaseStorage: async (objectName: string) => `storage-ref:${objectName}`,
  refreshSupabaseStorageUrl: async (ref: string) => `https://signed.example/${ref}`,
  normalizeToStorageRef: (u: string) => u,
  uploadPublicMediaToR2: async (_bucket: string, key: string) => `https://cdn.example/${key}`,
  parseSupabaseStorageRefBucketed: () => null,
  downloadStorageObjectBuffer: async () => null,
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const fakeDb = {
    select: () => ({
      from: () => ({
        where: (cond: unknown) => ({
          limit: async () => {
            const key = keyFromCondition(cond);
            const row = key !== null ? h.stored.get(key) : undefined;
            return row ? [row] : [];
          },
        }),
      }),
    }),
    insert: () => ({
      values: (v: { idempotencyKey: string; userId: string; rail: string; result: any }) => ({
        onConflictDoNothing: async () => {
          if (!h.stored.has(v.idempotencyKey)) {
            h.stored.set(v.idempotencyKey, { userId: v.userId, rail: v.rail, result: v.result });
          }
          return [];
        },
      }),
    }),
    update: () => ({ set: () => ({ where: async () => [] }) }),
    delete: () => ({ where: async () => [] }),
  };
  return { ...actual, db: fakeDb };
});

import lufsRouter, { __resetLufsReplayCache } from "../generate/lufs-meter";
import lyricVideoRouter, {
  __resetLyricVideoReplayCache,
  __clearLyricRenderJobs,
} from "../generate/lyric-video";
import karaokeRouter, { __resetKaraokeReplayCache } from "../generate/karaoke";

let base = "";
let server: ReturnType<express.Express["listen"]>;
const realFetch = globalThis.fetch;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(lufsRouter);
  app.use(lyricVideoRouter);
  app.use(karaokeRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await new Promise((r) => server.close(r));
});

beforeEach(() => {
  __resetLufsReplayCache();
  __resetLyricVideoReplayCache();
  __clearLyricRenderJobs();
  __resetKaraokeReplayCache();
  h.balance = 100_000;
  h.charges = []; h.refunds = []; h.voids = [];
  h.chargedKeys = new Set();
  h.stored = new Map();
  h.audioFetchMode = "ok";
  /* Global fetch: the staged-audio download (lyric render) and the
     karaoke audio download. "ok" returns junk audio bytes — enough
     to create a job, never enough for ffmpeg to succeed. */
  vi.stubGlobal("fetch", vi.fn(async () => {
    if (h.audioFetchMode === "fail") {
      return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({}),
      arrayBuffer: async () => new Uint8Array(Buffer.from("fake-audio-bytes")).buffer,
    };
  }));
});

async function post(path: string, body?: unknown) {
  const res = await realFetch(`${base}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => null)) as Record<string, any> | null };
}

async function postForm(path: string, form: FormData) {
  const res = await realFetch(`${base}${path}`, { method: "POST", body: form });
  return { status: res.status, json: (await res.json().catch(() => null)) as Record<string, any> | null };
}

async function waitFor(cond: () => boolean, timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe("lufs-meter normalize — CA-3 Pattern B", () => {
  const form = () => {
    const f = new FormData();
    f.append("targetLufs", "-14");
    f.append("format", "mp3");
    f.append("audio", new Blob([Buffer.from("fake-audio-bytes")], { type: "audio/mpeg" }), "song.mp3");
    return f;
  };

  it("replay returns the SAME jobId with one charge; after the job fails + refunds + voids, a retry charges fresh with a NEW jobId", async () => {
    const a = await postForm("/lufs/normalize", form());
    expect(a.status).toBe(202);
    expect(a.json?.["replayed"]).toBeUndefined();
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(100);
    const jobId = a.json?.["jobId"];
    expect(typeof jobId).toBe("string");

    const b = await postForm("/lufs/normalize", form());
    expect(b.status).toBe(202);
    expect(b.json?.["replayed"]).toBe(true);
    expect(b.json?.["jobId"]).toBe(jobId); // same job — no second job minted
    expect(h.charges).toHaveLength(1); // no second charge

    /* The job runs on junk audio: ffmpeg cannot measure it, so the
       job fails → refund + VOID (async, detached from the request). */
    await waitFor(() => h.refunds.length === 1);
    expect(h.refunds).toEqual([100]);
    await waitFor(() => h.voids.length === 1);

    const c = await postForm("/lufs/normalize", form());
    expect(c.status).toBe(202);
    expect(c.json?.["replayed"]).toBeUndefined();
    expect(c.json?.["jobId"]).not.toBe(jobId); // a NEW job
    expect(h.charges).toHaveLength(2); // charged fresh

    /* Drain the second job's async failure too, so its refund/void
       cannot bleed into the next test. */
    await waitFor(() => h.refunds.length === 2);
    await waitFor(() => h.voids.length === 2);
  }, 60_000);
});

describe("lyric-video render — CA-3 Pattern B", () => {
  const body = {
    audioRef: "https://audio.example/track.mp3",
    lines: [
      {
        text: "hello world",
        startSec: 0,
        endSec: 1,
        words: [{ word: "hello", startSec: 0, endSec: 1 }],
      },
    ],
    style: "gold-luxury",
    aspect: "16:9",
  };

  it("concurrent creates land ONE charge and ONE job; the twin is served as a replay of the same jobId", async () => {
    const [a, b] = await Promise.all([
      post("/lyric-video/render", body),
      post("/lyric-video/render", body),
    ]);
    expect(a.status).toBe(202);
    expect(b.status).toBe(202);
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(500);
    expect(a.json?.["jobId"]).toBe(b.json?.["jobId"]);
    const replayed = [a.json, b.json].filter((j) => j?.["replayed"] === true);
    expect(replayed).toHaveLength(1);

    /* The job runs on junk audio and fails async: drain its
       refund + void here so they cannot bleed into the next test. */
    await waitFor(() => h.refunds.length === 1);
    expect(h.refunds).toEqual([500]);
    await waitFor(() => h.voids.length === 1);
  }, 60_000);

  it("a missing staged audio refunds and VOIDS synchronously; the retry charges fresh", async () => {
    h.audioFetchMode = "fail";
    const failed = await post("/lyric-video/render", body);
    expect(failed.status).toBe(400);
    expect(failed.json?.["error"]).toBe("AUDIO_REF_EXPIRED");
    expect(h.refunds).toEqual([500]);
    expect(h.voids).toHaveLength(1);

    h.audioFetchMode = "ok";
    const retry = await post("/lyric-video/render", body);
    expect(retry.status).toBe(202);
    expect(h.charges).toHaveLength(2);

    /* Drain the retry job's async failure refund + void. */
    await waitFor(() => h.refunds.length === 2);
    await waitFor(() => h.voids.length === 2);
  }, 60_000);
});

describe("karaoke — CA-3 ffmpeg-family failure contract", () => {
  const body = {
    audioUrl: "https://media.example/song.mp3",
    lrc: "[00:01.00]hello world\n[00:03.00]foo bar",
    title: "Test Song",
  };

  it("a failed generation refunds and VOIDS the key; the retry charges fresh (never free)", async () => {
    h.audioFetchMode = "fail"; // the audio download cannot succeed
    const failed = await post("/karaoke-video", body);
    expect(failed.status).not.toBe(200);
    expect(h.refunds).toEqual([300]);
    expect(h.voids).toHaveLength(1);
    expect(h.stored.size).toBe(0);

    const retry = await post("/karaoke-video", body);
    expect(retry.status).not.toBe(200);
    expect(h.charges).toHaveLength(2); // charged AGAIN — the void did its job
    expect(h.refunds).toEqual([300, 300]);
    expect(h.voids).toHaveLength(2);
  });
});
