/**
 * CA-7 wave9 — double-charge fixes for the wave9 family:
 *   wave9a-music      structure generate (200) + lyrics-to-timeline (50),
 *                     keyed at the shared chargeOr402 helper, per-caller
 *                     scopes ("wave9a-structure" / "wave9a-lyrics-timing");
 *   wave9b-editor     beats detect (150, "wave9b-beats"), templates
 *                     apply (100, "wave9b-templates"), bg charge-on-
 *                     delivery (200, "wave9b-bg-replace" — NO refund
 *                     path exists on that site and none is invented);
 *   wave9c-direct-edit  voice-directed edits (150, "wave9c-direct-edit");
 *   wave9d-camera     camera move planner (100, "wave9d-camera");
 *   wave9d-director   character director shot plan (150, "wave9d-director").
 *
 * Per site this pins the CA-KEY contract:
 *   fresh → 1 charge, 1 provider/work run, stored row = response body,
 *           no replayed field;
 *   identical re-POST → stored body + replayed:true + replayNote,
 *           charges still 1, work still 1;
 *   failure (where a failure path exists) → today's exact error
 *           status/body + refund + voided key + no stored row;
 *   retry after failure → charges fresh and succeeds.
 * For wave9b bg/charge specifically: a replay after success serves the
 * stored result with NO second charge, and two DIFFERENT delivered
 * assets (different URL identity) charge separately.
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
  aiCalls: 0,
  aiMode: "ok" as "ok" | "throw",
  aiContent: "",
  decodeCalls: 0,
  silenceCalls: 0,
  ffmpegMode: "ok" as "ok" | "decode-fail" | "silence-fail",
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
      if (key && h.chargedKeys.has(key)) return h.balance; // ledger replay suppression
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

vi.mock("../../lib/ai-clients", () => ({
  getTextModel: () => "test-model",
  LOW_REASONING_PARAMS: { reasoning_effort: "low" },
  getOpenAI: () => ({
    chat: {
      completions: {
        create: async () => {
          h.aiCalls++;
          if (h.aiMode === "throw") throw new Error("provider down");
          return { choices: [{ message: { content: h.aiContent } }] };
        },
      },
    },
  }),
}));

vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
  freeAiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../lib/logger", () => ({
  logger: { info() {}, error() {}, warn() {}, debug() {} },
}));

vi.mock("../../lib/mirrorMedia", () => ({
  mirrorExternalMediaUrl: async () => null,
}));

vi.mock("../../lib/objectStorage", () => ({
  refreshSupabaseStorageUrlsDeep: async (v: unknown) => v,
  uploadMediaToSupabaseStorage: async (objectName: string) => `storage-ref:${objectName}`,
  refreshSupabaseStorageUrl: async (ref: string) => `https://signed.example/${ref}`,
  normalizeToStorageRef: (u: string) => u,
}));

/* wave9b's provider seam is ffmpeg via node:child_process: spawnSync
   answers the capability check, spawn either decodes PCM (beats) or
   reports silences (jump-cut), counted as the work runs. */
vi.mock("node:child_process", async () => {
  const { EventEmitter } = await import("node:events");
  function makeProc() {
    const proc: any = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    return proc;
  }
  return {
    spawnSync: () => ({ status: 0 }),
    spawn: (_cmd: string, args: string[]) => {
      const proc = makeProc();
      const isSilence = args.some((a) => a.includes("silencedetect"));
      setTimeout(() => {
        if (isSilence) {
          h.silenceCalls++;
          if (h.ffmpegMode === "silence-fail") {
            proc.emit("error", new Error("ffmpeg silence detect died"));
            return;
          }
          proc.stderr.emit("data", Buffer.from("silence_start: 1.0\nsilence_end: 2.0 | silence_duration: 1.0\n"));
          proc.emit("close", 0);
          return;
        }
        h.decodeCalls++;
        if (h.ffmpegMode === "decode-fail") {
          proc.stderr.emit("data", Buffer.from("decode boom"));
          proc.emit("close", 1);
          return;
        }
        const samples = new Float32Array(22050 * 2);
        for (let i = 0; i < samples.length; i += 11025) samples[i] = 1;
        proc.stdout.emit("data", Buffer.from(samples.buffer));
        proc.emit("close", 0);
      }, 0);
      return proc;
    },
    exec: () => { throw new Error("not used"); },
    execSync: () => Buffer.from(""),
    fork: () => { throw new Error("not used"); },
  };
});

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
          orderBy: () => ({
            limit: async () => [],
          }),
        }),
      }),
    }),
    insert: () => ({
      values: (v: { idempotencyKey?: string; userId: string; rail: string; result: any }) => ({
        onConflictDoNothing: async () => {
          if (typeof v.idempotencyKey === "string" && !h.stored.has(v.idempotencyKey)) {
            h.stored.set(v.idempotencyKey, { userId: v.userId, rail: v.rail, result: v.result });
          }
          return [];
        },
        returning: async () => [{ id: "plan-1" }],
      }),
    }),
    update: () => ({ set: () => ({ where: async () => [], returning: async () => [] }) }),
    delete: () => ({ where: async () => [] }),
  };
  return { ...actual, db: fakeDb };
});

import wave9aRouter, { __resetWave9aReplayCache } from "../wave9a-music";
import wave9bRouter, { __resetWave9bReplayCache } from "../wave9b-editor";
import wave9cRouter, { __resetWave9cReplayCache } from "../wave9c-direct-edit";
import wave9dCameraRouter, { __resetWave9dCameraReplayCache } from "../wave9d-camera";
import wave9dDirectorRouter, { __resetWave9dDirectorReplayCache } from "../wave9d-director";

let base = "";
let server: ReturnType<express.Express["listen"]>;
const realFetch = globalThis.fetch;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(wave9aRouter);
  app.use(wave9bRouter);
  app.use(wave9cRouter);
  app.use(wave9dCameraRouter);
  app.use(wave9dDirectorRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
});

beforeEach(() => {
  __resetWave9aReplayCache();
  __resetWave9bReplayCache();
  __resetWave9cReplayCache();
  __resetWave9dCameraReplayCache();
  __resetWave9dDirectorReplayCache();
  h.balance = 100_000;
  h.charges = []; h.refunds = []; h.voids = [];
  h.chargedKeys = new Set();
  h.stored = new Map();
  h.aiCalls = 0; h.aiMode = "ok"; h.aiContent = "";
  h.decodeCalls = 0; h.silenceCalls = 0; h.ffmpegMode = "ok";
});

async function post(path: string, body?: unknown) {
  const res = await realFetch(`${base}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => null)) as Record<string, any> | null };
}

const STRUCTURE_CONTENT = JSON.stringify({
  arrangement: [{ type: "verse", bars: 8, startsAtBar: 1, energy: "low simmer", direction: "Sparse piano, soft vocal.", lyricMap: "" }],
  totalBars: 8,
  notes: "Builds steadily.",
});
const TIMING_CONTENT = JSON.stringify({
  lines: [
    { text: "hello world", start: 0, end: 1.5 },
    { text: "second line", start: 1.5, end: 3 },
  ],
});
const DIRECT_CONTENT = JSON.stringify({
  planSummary: "Trim the first clip.",
  ops: [{ op: "trim", sceneId: "clip-1", trimStart: 1, trimEnd: 0, reason: "Tighten the open." }],
});
const DIRECTOR_CONTENT = JSON.stringify({
  shots: [{ shotIndex: 1, prompt: "A cinematic shot of the duo." }],
});

describe("wave9a structure generate — wave9a-structure, 200 VB", () => {
  const body = {
    sections: [{ type: "verse", bars: 8, label: "" }],
    lyrics: "la la",
    vibe: "moody",
    title: "Song",
  };

  it("fresh → 1 charge, 1 model run, stored row = body, no replayed field; re-POST → stored replay, no new charge or run", async () => {
    h.aiContent = STRUCTURE_CONTENT;
    const a = await post("/wave9a/structure/generate", body);
    expect(a.status).toBe(200);
    expect(a.json?.["replayed"]).toBeUndefined();
    expect(a.json?.["creditsUsed"]).toBe(200);
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(200);
    expect(h.charges[0]!.key).toMatch(/^wave9a-structure:user-1:/);
    expect(h.aiCalls).toBe(1);
    expect(h.stored.size).toBe(1);
    const row = [...h.stored.values()][0]!;
    expect(row.rail).toBe("wave9a-structure");
    expect(row.result).toEqual(a.json);

    const b = await post("/wave9a/structure/generate", body);
    expect(b.status).toBe(200);
    expect(b.json).toEqual({
      ...a.json,
      replayed: true,
      replayNote: "This is the arrangement you already made for this request — tweak the sections, lyrics or vibe for a fresh one.",
    });
    expect(h.charges).toHaveLength(1);
    expect(h.aiCalls).toBe(1);
  });

  it("failure → today's 500 + refund + void + no stored row; retry charges fresh and succeeds", async () => {
    h.aiContent = STRUCTURE_CONTENT;
    h.aiMode = "throw";
    const failed = await post("/wave9a/structure/generate", body);
    expect(failed.status).toBe(500);
    expect(failed.json).toEqual({
      error: "The structure studio hiccupped — your Visual Bucs were refunded.",
      refunded: true,
    });
    expect(h.refunds).toEqual([200]);
    expect(h.voids).toHaveLength(1);
    expect(h.voids[0]).toMatch(/^wave9a-structure:user-1:/);
    expect(h.stored.size).toBe(0);

    h.aiMode = "ok";
    const retry = await post("/wave9a/structure/generate", body);
    expect(retry.status).toBe(200);
    expect(h.charges).toHaveLength(2);
    expect(h.aiCalls).toBe(2);
  });
});

describe("wave9a lyrics-to-timeline — wave9a-lyrics-timing, 50 VB", () => {
  const body = { lyrics: "hello world\nsecond line", durationSec: 120, title: "Song" };

  it("fresh → 1 charge of 50, 1 model run, stored; re-POST → stored replay; and the two callers never serve each other's results", async () => {
    h.aiContent = TIMING_CONTENT;
    const a = await post("/wave9a/lyrics/timing", body);
    expect(a.status).toBe(200);
    expect(a.json?.["replayed"]).toBeUndefined();
    expect(a.json?.["creditsUsed"]).toBe(50);
    expect(a.json?.["lines"]).toHaveLength(2);
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(50);
    expect(h.charges[0]!.key).toMatch(/^wave9a-lyrics-timing:user-1:/);
    expect(h.aiCalls).toBe(1);
    expect(h.stored.size).toBe(1);
    expect([...h.stored.values()][0]!.rail).toBe("wave9a-lyrics-timing");

    const b = await post("/wave9a/lyrics/timing", body);
    expect(b.status).toBe(200);
    expect(b.json).toEqual({
      ...a.json,
      replayed: true,
      replayNote: "These are the lyric timings you already made for this request — tweak the lyrics or duration for a fresh set.",
    });
    expect(h.charges).toHaveLength(1);
    expect(h.aiCalls).toBe(1);

    /* Per-caller storage: a structure ask under the same roof gets its
       own key, its own charge and its own stored body — never the
       lyrics result. */
    h.aiContent = STRUCTURE_CONTENT;
    const s = await post("/wave9a/structure/generate", {
      sections: [{ type: "verse", bars: 8, label: "" }],
      lyrics: "hello world\nsecond line",
      vibe: "",
      title: "Song",
    });
    expect(s.status).toBe(200);
    expect(s.json?.["arrangement"]).toBeDefined();
    expect(s.json?.["lines"]).toBeUndefined();
    expect(h.charges).toHaveLength(2);
    expect(h.stored.size).toBe(2);
  });

  it("failure → today's 500 + refund + void + no stored row; retry charges fresh and succeeds", async () => {
    h.aiContent = TIMING_CONTENT;
    h.aiMode = "throw";
    const failed = await post("/wave9a/lyrics/timing", body);
    expect(failed.status).toBe(500);
    expect(failed.json).toEqual({
      error: "The timing studio hiccupped — your Visual Bucs were refunded.",
      refunded: true,
    });
    expect(h.refunds).toEqual([50]);
    expect(h.voids).toHaveLength(1);
    expect(h.voids[0]).toMatch(/^wave9a-lyrics-timing:user-1:/);
    expect(h.stored.size).toBe(0);

    h.aiMode = "ok";
    const retry = await post("/wave9a/lyrics/timing", body);
    expect(retry.status).toBe(200);
    expect(h.charges).toHaveLength(2);
  });
});

describe("wave9b beats detect — wave9b-beats, 150 VB", () => {
  const body = { mediaUrl: "https://media.example/track.mp3", maxAnalyzeSec: 60 };

  it("fresh → 1 charge, 1 decode run, stored row = body; re-POST → stored replay, no new charge or decode", async () => {
    const a = await post("/wave9b/beats/detect", body);
    expect(a.status).toBe(200);
    expect(a.json?.["replayed"]).toBeUndefined();
    expect(a.json?.["creditsUsed"]).toBe(150);
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(150);
    expect(h.decodeCalls).toBe(1);
    expect(h.stored.size).toBe(1);
    const row = [...h.stored.values()][0]!;
    expect(row.rail).toBe("wave9b-beats");
    expect(row.result).toEqual(a.json);

    const b = await post("/wave9b/beats/detect", body);
    expect(b.status).toBe(200);
    expect(b.json).toEqual({
      ...a.json,
      replayed: true,
      replayNote: "These are the beats you already detected for this request — change the audio or window for a fresh pass.",
    });
    expect(h.charges).toHaveLength(1);
    expect(h.decodeCalls).toBe(1);
  });

  it("failure → today's 500 + refund + void + no stored row; retry charges fresh and succeeds", async () => {
    h.ffmpegMode = "decode-fail";
    const failed = await post("/wave9b/beats/detect", body);
    expect(failed.status).toBe(500);
    expect(failed.json?.["refunded"]).toBe(true);
    expect(String(failed.json?.["error"])).toContain("Beat detection failed");
    expect(h.refunds).toEqual([150]);
    expect(h.voids).toHaveLength(1);
    expect(h.voids[0]).toMatch(/^wave9b-beats:user-1:/);
    expect(h.stored.size).toBe(0);

    h.ffmpegMode = "ok";
    const retry = await post("/wave9b/beats/detect", body);
    expect(retry.status).toBe(200);
    expect(h.charges).toHaveLength(2);
    expect(h.decodeCalls).toBe(2);
  });
});

describe("wave9b templates apply — wave9b-templates, 100 VB", () => {
  const body = {
    recipeId: "jumpcut-vlog",
    mediaUrl: "https://media.example/vlog.mp4",
    minPauseSec: 0.8,
    durationSec: 60,
    beatGrid: [] as number[],
  };

  it("fresh → 1 charge, 1 silence run, stored row = body; re-POST → stored replay, no new charge or run", async () => {
    const a = await post("/wave9b/templates/apply", body);
    expect(a.status).toBe(200);
    expect(a.json?.["replayed"]).toBeUndefined();
    expect(a.json?.["creditsUsed"]).toBe(100);
    expect(a.json?.["opCount"]).toBe(4); // 1 cut + transition + captions + audio
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(100);
    expect(h.silenceCalls).toBe(1);
    expect(h.stored.size).toBe(1);
    const row = [...h.stored.values()][0]!;
    expect(row.rail).toBe("wave9b-templates");
    expect(row.result).toEqual(a.json);

    const b = await post("/wave9b/templates/apply", body);
    expect(b.status).toBe(200);
    expect(b.json).toEqual({
      ...a.json,
      replayed: true,
      replayNote: "This is the edit recipe you already made for this request — tweak the recipe inputs for a fresh one.",
    });
    expect(h.charges).toHaveLength(1);
    expect(h.silenceCalls).toBe(1);
  });

  it("failure → today's 500 + refund + void + no stored row; retry charges fresh and succeeds", async () => {
    h.ffmpegMode = "silence-fail";
    const failed = await post("/wave9b/templates/apply", body);
    expect(failed.status).toBe(500);
    expect(failed.json).toEqual({
      error: "The edit recipe failed — your Visual Bucs were refunded.",
      refunded: true,
    });
    expect(h.refunds).toEqual([100]);
    expect(h.voids).toHaveLength(1);
    expect(h.voids[0]).toMatch(/^wave9b-templates:user-1:/);
    expect(h.stored.size).toBe(0);

    h.ffmpegMode = "ok";
    const retry = await post("/wave9b/templates/apply", body);
    expect(retry.status).toBe(200);
    expect(h.charges).toHaveLength(2);
    expect(h.silenceCalls).toBe(2);
  });
});

describe("wave9b bg charge-on-delivery — wave9b-bg-replace, 200 VB, NO refund path", () => {
  const bodyA = { sceneId: "scene-1", deliveredAssetUrl: "https://cdn.example/replaced-a.webm" };

  it("fresh → 1 charge of 200, stored result; re-POST serves the stored result with NO second charge", async () => {
    const a = await post("/wave9b/bg/charge", bodyA);
    expect(a.status).toBe(200);
    expect(a.json).toEqual({ ok: true, remaining: 100_000 - 200 });
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(200);
    expect(h.charges[0]!.key).toMatch(/^wave9b-bg-replace:user-1:/);
    expect(h.stored.size).toBe(1);
    expect([...h.stored.values()][0]!.rail).toBe("wave9b-bg-replace");
    expect([...h.stored.values()][0]!.result).toEqual(a.json);

    const b = await post("/wave9b/bg/charge", bodyA);
    expect(b.status).toBe(200);
    expect(b.json).toEqual({
      ...a.json,
      replayed: true,
      replayNote: "This background replacement was already charged for this delivery — you have not been charged again.",
    });
    expect(h.charges).toHaveLength(1); // the retried charge did NOT charge 200 again
    expect(h.refunds).toHaveLength(0);
  });

  it("two DIFFERENT delivered assets under the same scene charge separately", async () => {
    const a = await post("/wave9b/bg/charge", bodyA);
    expect(a.status).toBe(200);
    const other = await post("/wave9b/bg/charge", {
      sceneId: "scene-1",
      deliveredAssetUrl: "https://cdn.example/replaced-b.webm",
    });
    expect(other.status).toBe(200);
    expect(other.json?.["replayed"]).toBeUndefined();
    expect(h.charges).toHaveLength(2);
    expect(h.stored.size).toBe(2);
  });

  it("out of credits → today's exact 402, no charge, no stored row, and (by design) no refund machinery at all", async () => {
    h.balance = 100;
    const res = await post("/wave9b/bg/charge", bodyA);
    expect(res.status).toBe(402);
    expect(res.json).toEqual({
      error: "out_of_credits",
      message: "Not enough Visual Bucs — top up to keep your replaced background.",
    });
    expect(h.charges).toHaveLength(0);
    expect(h.refunds).toHaveLength(0);
    expect(h.voids).toHaveLength(0);
    expect(h.stored.size).toBe(0);
  });
});

describe("wave9c direct edit — wave9c-direct-edit, 150 VB", () => {
  const body = {
    command: "trim the first clip",
    timeline: [{ id: "clip-1", index: 0, section: "intro", startSec: 0, endSec: 10, volume: 100 }],
    totalDurationSec: 10,
    projectTitle: "Proj",
  };

  it("fresh → 1 charge, 1 model run, stored row = body; re-POST → stored replay, no new charge or run", async () => {
    h.aiContent = DIRECT_CONTENT;
    const a = await post("/wave9c/direct/edit", body);
    expect(a.status).toBe(200);
    expect(a.json?.["replayed"]).toBeUndefined();
    expect(a.json?.["creditsUsed"]).toBe(150);
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(150);
    expect(h.aiCalls).toBe(1);
    expect(h.stored.size).toBe(1);
    const row = [...h.stored.values()][0]!;
    expect(row.rail).toBe("wave9c-direct-edit");
    expect(row.result).toEqual(a.json);

    const b = await post("/wave9c/direct/edit", body);
    expect(b.status).toBe(200);
    expect(b.json).toEqual({
      ...a.json,
      replayed: true,
      replayNote: "This is the edit plan you already made for this request — tweak the command or timeline for a fresh one.",
    });
    expect(h.charges).toHaveLength(1);
    expect(h.aiCalls).toBe(1);
  });

  it("failure → today's 500 + refund + void + no stored row; retry charges fresh and succeeds", async () => {
    h.aiContent = DIRECT_CONTENT;
    h.aiMode = "throw";
    const failed = await post("/wave9c/direct/edit", body);
    expect(failed.status).toBe(500);
    expect(failed.json).toEqual({
      error: "Voice-Directed Edits hiccupped — your Visual Bucs were refunded.",
      refunded: true,
    });
    expect(h.refunds).toEqual([150]);
    expect(h.voids).toHaveLength(1);
    expect(h.voids[0]).toMatch(/^wave9c-direct-edit:user-1:/);
    expect(h.stored.size).toBe(0);

    h.aiMode = "ok";
    const retry = await post("/wave9c/direct/edit", body);
    expect(retry.status).toBe(200);
    expect(h.charges).toHaveLength(2);
    expect(h.aiCalls).toBe(2);
  });
});

describe("wave9d camera prompt — wave9d-camera, 100 VB", () => {
  const body = {
    move: "dolly-in",
    intensity: "natural",
    basePrompt: "A singer on a rooftop at dusk",
    sceneContext: "",
  };

  it("fresh → 1 charge, 1 model run, stored row = body; re-POST → stored replay, no new charge or run", async () => {
    h.aiContent = "A woven cinematic prompt.";
    const a = await post("/wave9d/camera/prompt", body);
    expect(a.status).toBe(200);
    expect(a.json?.["replayed"]).toBeUndefined();
    expect(a.json?.["enrichedPrompt"]).toBe("A woven cinematic prompt.");
    expect(a.json?.["creditsUsed"]).toBe(100);
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(100);
    expect(h.aiCalls).toBe(1);
    expect(h.stored.size).toBe(1);
    const row = [...h.stored.values()][0]!;
    expect(row.rail).toBe("wave9d-camera");
    expect(row.result).toEqual(a.json);

    const b = await post("/wave9d/camera/prompt", body);
    expect(b.status).toBe(200);
    expect(b.json).toEqual({
      ...a.json,
      replayed: true,
      replayNote: "This is the camera prompt you already made for this request — tweak the prompt or move for a fresh one.",
    });
    expect(h.charges).toHaveLength(1);
    expect(h.aiCalls).toBe(1);
  });

  it("failure → today's 500 + refund + void + no stored row; retry charges fresh and succeeds", async () => {
    h.aiContent = "A woven cinematic prompt.";
    h.aiMode = "throw";
    const failed = await post("/wave9d/camera/prompt", body);
    expect(failed.status).toBe(500);
    expect(failed.json).toEqual({
      error: "The camera planner hiccupped — your Visual Bucs were refunded.",
      refunded: true,
    });
    expect(h.refunds).toEqual([100]);
    expect(h.voids).toHaveLength(1);
    expect(h.voids[0]).toMatch(/^wave9d-camera:user-1:/);
    expect(h.stored.size).toBe(0);

    h.aiMode = "ok";
    const retry = await post("/wave9d/camera/prompt", body);
    expect(retry.status).toBe(200);
    expect(h.charges).toHaveLength(2);
    expect(h.aiCalls).toBe(2);
  });
});

describe("wave9d director plan — wave9d-director, 150 VB", () => {
  const body = {
    name: "Launch plan",
    cast: [
      { vaultId: "", name: "Nova", description: "Singer with a gold chain" },
      { vaultId: "", name: "Rex", description: "Producer in a black cap" },
    ],
    shots: [{ index: 1, characters: ["Nova", "Rex"], action: "Nova performs at the mic", cameraNote: "slow push-in" }],
    sceneStyle: "neon studio",
  };

  it("fresh → 1 charge, 1 model run, stored row = body; re-POST → stored replay, no new charge or run (and no second plan insert)", async () => {
    h.aiContent = DIRECTOR_CONTENT;
    const a = await post("/wave9d/director/plan", body);
    expect(a.status).toBe(200);
    expect(a.json?.["replayed"]).toBeUndefined();
    expect(a.json?.["planId"]).toBe("plan-1");
    expect(a.json?.["creditsUsed"]).toBe(150);
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(150);
    expect(h.aiCalls).toBe(1);
    expect(h.stored.size).toBe(1);
    const row = [...h.stored.values()][0]!;
    expect(row.rail).toBe("wave9d-director");
    expect(row.result).toEqual(a.json);

    const b = await post("/wave9d/director/plan", body);
    expect(b.status).toBe(200);
    expect(b.json).toEqual({
      ...a.json,
      replayed: true,
      replayNote: "This is the shot plan you already made for this request — tweak the cast or shots for a fresh one.",
    });
    expect(h.charges).toHaveLength(1);
    expect(h.aiCalls).toBe(1);
  });

  it("failure → today's 500 + refund + void + no stored row; retry charges fresh and succeeds", async () => {
    h.aiContent = DIRECTOR_CONTENT;
    h.aiMode = "throw";
    const failed = await post("/wave9d/director/plan", body);
    expect(failed.status).toBe(500);
    expect(failed.json).toEqual({
      error: "The director hiccupped — your Visual Bucs were refunded.",
      refunded: true,
    });
    expect(h.refunds).toEqual([150]);
    expect(h.voids).toHaveLength(1);
    expect(h.voids[0]).toMatch(/^wave9d-director:user-1:/);
    expect(h.stored.size).toBe(0);

    h.aiMode = "ok";
    const retry = await post("/wave9d/director/plan", body);
    expect(retry.status).toBe(200);
    expect(h.charges).toHaveLength(2);
    expect(h.aiCalls).toBe(2);
  });
});
