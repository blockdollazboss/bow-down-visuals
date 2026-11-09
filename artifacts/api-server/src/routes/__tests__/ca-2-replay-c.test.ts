/**
 * CA-2 lane (worker C) — replay/idempotency coverage for:
 *   community.ts (all FOUR handlers: moderate — converted by the
 *     original builder before the daemon restart, kept after review —
 *     plus reply-drafts / sentiment / superfan converted here),
 *   distribution.ts AI metadata + AI strategy (helper chargeOr402),
 *   caption-styler.ts, deverb.ts, filler-removal.ts (helper
 *     chargeForAnalyze), freeze-mask.ts (helper startJob) — Pattern B.
 *
 * House harness shape (generation-stored-results.test.ts): express app
 * + key-aware mocked credits (duplicate keys are suppressed by the
 * fake ledger, exactly like the real one) + @workspace/db fake serving
 * ONLY the generation_stored_results select/insert chains + mocked
 * providers (OpenAI chat via ai-clients, transcription, child_process
 * ffmpeg/ffprobe, object storage, global fetch for media downloads).
 *
 * Per Pattern A rail: fresh = one charge / bare body / one stored row;
 * re-ask = stored body + replayed:true / still one charge / provider
 * count unchanged; failure = refund + key voided / nothing stored /
 * retry charges fresh. Moderate also pins the concurrent-duplicate
 * case (two simultaneous POSTs → one charge, one provider call).
 *
 * Per Pattern B rail: fresh = one charge / bare 202 / ONE job whose id
 * derives from the charge key; re-ask = SAME job id + replayed:true /
 * still one charge; a completed job persists its creation body in the
 * stored-results table; failure = refund + key voided / nothing
 * stored / retry charges fresh under the same deterministic job id.
 * (Deverb's provider is deliberately unimplemented upstream, so its
 * jobs always fail after the charge — the failure + in-flight replay
 * semantics are what can be pinned there.)
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
  chatCalls: 0,
  chatMode: "ok" as "ok" | "throw",
  transcribeCalls: 0,
  transcribeMode: "ok" as "ok" | "throw",
  mediaMode: "ok" as "ok" | "throw",
  execMode: "ok" as "ok" | "throw",
}));

/* Recover the lookup key from the eq() the stored-results lib built
   (same walker as generation-stored-results.test.ts). */
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
        create: async (args: any) => {
          h.chatCalls++;
          if (h.chatMode === "throw") throw new Error("provider down");
          const system = String(args?.messages?.[0]?.content ?? "");
          let content: string;
          if (system.includes("community moderation assistant")) {
            content = JSON.stringify([
              { index: 0, author: "fan1", text: "spammy link", verdict: "review", reasons: ["spam"], severity: 55 },
            ]);
          } else if (system.includes("drafting comment replies")) {
            content = JSON.stringify([{ index: 0, reply: "that means everything — new drop Friday" }]);
          } else if (system.includes("audience sentiment analyst")) {
            content = JSON.stringify({
              overall: "positive", score: 88,
              themes: [{ theme: "the hook", sentiment: "positive", examples: ["stuck in my head"] }],
              risks: [], wins: ["the hook"],
            });
          } else if (system.includes("identifying superfans")) {
            content = JSON.stringify({
              superfans: [{ author: "fan1", score: 95, why: "first on every post", commentCount: 12 }],
            });
          } else if (system.includes("music-marketing copywriter")) {
            content = JSON.stringify({
              titleOptions: ["Midnight Tide", "Gold Water"],
              description: "A dark luxury trap anthem.",
              genreTags: ["trap", "phonk"],
            });
          } else if (system.includes("release strategist")) {
            content = JSON.stringify({
              timing: "Release on Friday.",
              promoPlan: ["Tease on TikTok", "Pre-save push"],
              checklist: ["Artwork 3000x3000", "ISRC codes"],
            });
          } else {
            content = "{}";
          }
          return { choices: [{ message: { content } }] };
        },
      },
    },
  }),
}));

vi.mock("../../lib/transcription", () => ({
  transcribeAudioTimed: async () => {
    h.transcribeCalls++;
    if (h.transcribeMode === "throw") throw new Error("transcription down");
    return {
      text: "um hello world",
      duration: 42,
      language: "en",
      words: [
        { word: "um", start: 0, end: 0.3 },
        { word: "hello", start: 0.4, end: 0.8 },
        { word: "world", start: 0.9, end: 1.3 },
      ],
    };
  },
}));

vi.mock("../../lib/objectStorage", () => ({
  uploadMediaToSupabaseStorage: async (objectName: string) => `storage-ref:${objectName}`,
  refreshSupabaseStorageUrl: async (ref: string) => `https://signed.example/${ref}`,
  refreshSupabaseStorageUrlsDeep: async (v: unknown) => v,
  normalizeToStorageRef: (u: string) => u,
}));

vi.mock("child_process", () => ({
  execFile: (cmd: string, args: unknown, opts: unknown, cb?: unknown) => {
    const callback = (typeof opts === "function" ? opts : cb) as (
      err: Error | null,
      out?: { stdout: string; stderr: string },
    ) => void;
    (async () => {
      if (h.execMode === "throw") throw new Error("exec boom");
      const argList = Array.isArray(args) ? args.map(String) : [];
      let stdout = "";
      if (cmd === "ffprobe") {
        const joined = argList.join(" ");
        if (joined.includes("width,height")) stdout = "1280,720\n";
        else if (joined.includes("a:0")) stdout = "audio\n";
        else stdout = "30/1\n10.000000\n";
      } else if (cmd === "ffmpeg") {
        const last = argList[argList.length - 1];
        if (last && last !== "-" && /\.(mp4|mp3|m4a)$/.test(last)) {
          const fsp = await import("node:fs");
          fsp.writeFileSync(last, Buffer.from("fake-media-bytes"));
        }
      }
      return { stdout, stderr: "" };
    })().then(
      (r) => callback(null, r),
      (e) => callback(e as Error),
    );
  },
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
    execute: async () => ({ rows: [] }),
  };
  return { ...actual, db: fakeDb };
});

import communityRouter from "../generate/community";
import distributionRouter from "../generate/distribution";
import captionStylerRouter, { __clearCaptionStylerJobs } from "../generate/caption-styler";
import deverbRouter from "../generate/deverb";
import fillerRouter, { __clearFillerRemovalJobs } from "../generate/filler-removal";
import freezeRouter from "../generate/freeze-mask";

let base = "";
let server: ReturnType<express.Express["listen"]>;
const realFetch = globalThis.fetch;

beforeAll(async () => {
  process.env["DEVERB_API_KEY"] = "test-key-not-real";
  delete process.env["SUPABASE_URL"];
  const app = express();
  app.use(express.json());
  app.use(communityRouter);
  app.use(distributionRouter);
  app.use(captionStylerRouter);
  app.use(deverbRouter);
  app.use(fillerRouter);
  app.use(freezeRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  delete process.env["DEVERB_API_KEY"];
  vi.unstubAllGlobals();
  await new Promise((r) => server.close(r));
});

beforeEach(() => {
  h.balance = 100_000;
  h.charges = []; h.refunds = []; h.voids = [];
  h.chargedKeys = new Set();
  h.stored = new Map();
  h.chatCalls = 0; h.chatMode = "ok";
  h.transcribeCalls = 0; h.transcribeMode = "ok";
  h.mediaMode = "ok";
  h.execMode = "ok";
  __clearCaptionStylerJobs();
  __clearFillerRemovalJobs();
  /* App-side media downloads (filler / freeze) ride the global fetch;
     the test client below uses realFetch directly. */
  vi.stubGlobal("fetch", vi.fn(async (url: unknown, init?: { method?: string }) => {
    const u = String(url);
    if (u.includes("media.example")) {
      if (h.mediaMode === "throw") throw new Error("download down");
      if (init?.method === "HEAD") {
        return { headers: { get: (_k: string) => "1024" } };
      }
      return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer };
    }
    throw new Error(`unexpected fetch in test: ${u}`);
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

async function getJson(path: string) {
  const res = await realFetch(`${base}${path}`);
  return { status: res.status, json: (await res.json().catch(() => null)) as Record<string, any> | null };
}

async function pollJob(path: string, want: string, tries = 150): Promise<Record<string, any>> {
  for (let i = 0; i < tries; i++) {
    const { json } = await getJson(path);
    if (json && json["status"] === want) return json;
    await new Promise((r) => setTimeout(r, 20));
  }
  const last = await getJson(path);
  throw new Error(`job at ${path} never reached "${want}" (last: ${JSON.stringify(last.json)})`);
}

/* ─── community.ts — Pattern A × 4 ───────────────────────────────────── */

const COMMENTS = [{ author: "fan1", text: "spammy link here" }];

function patternACases(opts: {
  name: string;
  path: string;
  body: unknown;
  scopePrefix: string;
  rail: string;
  cost: number;
}) {
  describe(`${opts.name} — CA-2 replay (Pattern A)`, () => {
    it("fresh charges once + stores one row; re-ask serves the stored body with replayed:true", async () => {
      const a = await post(opts.path, opts.body);
      expect(a.status).toBe(200);
      expect(a.json?.["replayed"]).toBeUndefined();
      expect(h.charges).toHaveLength(1);
      expect(h.charges[0]!.amount).toBe(opts.cost);
      expect(h.charges[0]!.key).toMatch(new RegExp(`^${opts.scopePrefix}:`));
      const callsAfterFresh = h.chatCalls;
      expect(callsAfterFresh).toBe(1);
      expect(h.stored.size).toBe(1);
      const row = [...h.stored.values()][0]!;
      expect(row.rail).toBe(opts.rail);
      expect(row.result).toEqual(a.json);

      const b = await post(opts.path, opts.body);
      expect(b.status).toBe(200);
      expect(b.json).toEqual({ ...a.json, replayed: true });
      expect(h.charges).toHaveLength(1);
      expect(h.chatCalls).toBe(callsAfterFresh);
    });

    it("provider failure refunds + voids the key and stores nothing; the retry charges fresh", async () => {
      h.chatMode = "throw";
      const failed = await post(opts.path, opts.body);
      expect(failed.status).toBe(502);
      expect(h.refunds).toEqual([opts.cost]);
      expect(h.voids).toHaveLength(1);
      expect(h.voids[0]).toMatch(new RegExp(`^${opts.scopePrefix}:`));
      expect(h.stored.size).toBe(0);

      h.chatMode = "ok";
      const retry = await post(opts.path, opts.body);
      expect(retry.status).toBe(200);
      expect(retry.json?.["replayed"]).toBeUndefined();
      expect(h.charges).toHaveLength(2);
    });
  });
}

patternACases({
  name: "community moderate (inherited conversion, kept)",
  path: "/community/moderate",
  body: { comments: COMMENTS },
  scopePrefix: "community-moderation",
  rail: "community-moderation",
  cost: 100,
});
patternACases({
  name: "community reply-drafts",
  path: "/community/reply-draft",
  body: { comments: COMMENTS, tone: "friendly", creatorName: "" },
  scopePrefix: "community-reply-drafts",
  rail: "community-reply-drafts",
  cost: 100,
});
patternACases({
  name: "community sentiment",
  path: "/community/sentiment",
  body: { comments: COMMENTS, timeframe: "this week" },
  scopePrefix: "community-sentiment",
  rail: "community-sentiment",
  cost: 100,
});
patternACases({
  name: "community superfans",
  path: "/community/superfans",
  body: { comments: COMMENTS },
  scopePrefix: "community-superfan-radar",
  rail: "community-superfan-radar",
  cost: 100,
});

describe("community moderate — concurrent duplicates", () => {
  it("two simultaneous identical POSTs share one charge and one provider call", async () => {
    const [a, b] = await Promise.all([
      post("/community/moderate", { comments: COMMENTS }),
      post("/community/moderate", { comments: COMMENTS }),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(h.charges).toHaveLength(1);
    expect(h.chatCalls).toBe(1);
    expect([a.json, b.json].filter((j) => j?.["replayed"] === true)).toHaveLength(1);
  });
});

/* ─── distribution.ts — Pattern A via the chargeOr402 helper ─────────── */

patternACases({
  name: "distribution AI metadata",
  path: "/distribution/metadata",
  body: { vibe: "dark trap" },
  scopePrefix: "distribution-ai-metadata",
  rail: "distribution-ai-metadata",
  cost: 100,
});
patternACases({
  name: "distribution AI strategy",
  path: "/distribution/strategy",
  body: { title: "T", artistName: "A", platforms: ["spotify"] },
  scopePrefix: "distribution-ai-strategy",
  rail: "distribution-ai-strategy",
  cost: 100,
});

/* ─── caption-styler.ts — Pattern B ──────────────────────────────────── */

function captionForm(bytes: string): FormData {
  const fd = new FormData();
  fd.append("style", "hormozi");
  fd.append("video", new Blob([bytes], { type: "video/mp4" }), "clip.mp4");
  return fd;
}

describe("caption-styler — CA-2 replay (Pattern B)", () => {
  it("fresh mints ONE job under the key-derived id; re-ask returns the SAME job; completion stores one row", async () => {
    const a = await postForm("/caption-styler", captionForm("caption-bytes-alpha"));
    expect(a.status).toBe(202);
    expect(a.json?.["replayed"]).toBeUndefined();
    expect(String(a.json?.["jobId"])).toHaveLength(32);
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(300);
    expect(h.charges[0]!.key).toMatch(/^caption-styler:/);

    const done = await pollJob(`/caption-styler/${a.json!["jobId"]}`, "done");
    expect(done["outputUrl"]).toContain("https://signed.example/");
    expect(h.stored.size).toBe(1);
    const row = [...h.stored.values()][0]!;
    expect(row.rail).toBe("caption-styler");
    expect(row.result["jobId"]).toBe(a.json!["jobId"]);

    const b = await postForm("/caption-styler", captionForm("caption-bytes-alpha"));
    expect(b.status).toBe(202);
    expect(b.json?.["jobId"]).toBe(a.json!["jobId"]);
    expect(b.json?.["replayed"]).toBe(true);
    expect(h.charges).toHaveLength(1);
    expect(h.transcribeCalls).toBe(1);
  });

  it("a failed job refunds + voids its key and stores nothing; the retry charges fresh under the same job id", async () => {
    h.transcribeMode = "throw";
    const a = await postForm("/caption-styler", captionForm("caption-bytes-bravo"));
    expect(a.status).toBe(202);
    expect(h.charges).toHaveLength(1);

    await pollJob(`/caption-styler/${a.json!["jobId"]}`, "failed");
    expect(h.refunds).toEqual([300]);
    expect(h.voids).toHaveLength(1);
    expect(h.voids[0]).toMatch(/^caption-styler:/);
    expect(h.stored.size).toBe(0);

    h.transcribeMode = "ok";
    const retry = await postForm("/caption-styler", captionForm("caption-bytes-bravo"));
    expect(retry.status).toBe(202);
    expect(retry.json?.["jobId"]).toBe(a.json!["jobId"]);
    expect(retry.json?.["replayed"]).toBeUndefined();
    expect(h.charges).toHaveLength(2);
    await pollJob(`/caption-styler/${a.json!["jobId"]}`, "done");
  });

  it("two simultaneous identical uploads produce one charge and one job", async () => {
    const [a, b] = await Promise.all([
      postForm("/caption-styler", captionForm("caption-bytes-charlie")),
      postForm("/caption-styler", captionForm("caption-bytes-charlie")),
    ]);
    expect(a.status).toBe(202);
    expect(b.status).toBe(202);
    expect(a.json?.["jobId"]).toBe(b.json?.["jobId"]);
    expect(h.charges).toHaveLength(1);
    expect([a.json, b.json].filter((j) => j?.["replayed"] === true)).toHaveLength(1);
    await pollJob(`/caption-styler/${a.json!["jobId"]}`, "done");
    expect(h.transcribeCalls).toBe(1);
  });
});

/* ─── deverb.ts — Pattern B (provider unimplemented: jobs fail) ─────── */

function deverbForm(bytes: string): FormData {
  const fd = new FormData();
  fd.append("mode", "dialogue");
  fd.append("audio", new Blob([bytes], { type: "audio/mpeg" }), "voice.mp3");
  return fd;
}

describe("deverb — CA-2 replay (Pattern B)", () => {
  it("concurrent duplicates return the SAME job with one charge; failure refunds + voids; retry charges fresh", async () => {
    /* The deverb provider is deliberately unimplemented, so a job
       fails almost immediately after creation — the same-ask replay
       is therefore pinned on CONCURRENT posts (the twin-map +
       live-job window), with a multi-MB upload so the first job's
       copy step outlasts the twin's arrival. Sequential re-ask after
       the failure is the retry case below. */
    const bigBytes = "deverb-alpha-".repeat(400_000); // ~5 MB
    const [a, b] = await Promise.all([
      postForm("/deverb", deverbForm(bigBytes)),
      postForm("/deverb", deverbForm(bigBytes)),
    ]);
    expect(a.status).toBe(202);
    expect(b.status).toBe(202);
    expect(String(a.json?.["jobId"])).toHaveLength(32);
    expect(b.json?.["jobId"]).toBe(a.json!["jobId"]);
    expect([a.json, b.json].filter((j) => j?.["replayed"] === true)).toHaveLength(1);
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(1000);
    expect(h.charges[0]!.key).toMatch(/^deverb:/);

    await pollJob(`/deverb/${a.json!["jobId"]}`, "failed");
    expect(h.refunds).toEqual([1000]);
    expect(h.voids).toHaveLength(1);
    expect(h.voids[0]).toMatch(/^deverb:/);
    expect(h.stored.size).toBe(0);

    const retry = await postForm("/deverb", deverbForm(bigBytes));
    expect(retry.status).toBe(202);
    expect(retry.json?.["jobId"]).toBe(a.json!["jobId"]);
    expect(retry.json?.["replayed"]).toBeUndefined();
    expect(h.charges).toHaveLength(2);
    await pollJob(`/deverb/${a.json!["jobId"]}`, "failed");
  });
});

/* ─── filler-removal.ts — Pattern B via chargeForAnalyze ─────────────── */

describe("filler-removal analyze — CA-2 replay (Pattern B)", () => {
  const body = {
    mediaUrl: "https://media.example/clip-alpha.mp4",
    fillerWords: ["um"],
    removeSilences: false,
  };

  it("fresh mints ONE job under the key-derived id; re-ask returns the SAME job; completion stores one row", async () => {
    const a = await post("/remove-fillers/analyze", body);
    expect(a.status).toBe(202);
    expect(a.json?.["replayed"]).toBeUndefined();
    expect(String(a.json?.["jobId"])).toHaveLength(32);
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(200);
    expect(h.charges[0]!.key).toMatch(/^filler-removal-analyze:/);

    const done = await pollJob(`/remove-fillers/analyze/${a.json!["jobId"]}`, "done");
    expect(Array.isArray(done["cuts"])).toBe(true);
    expect((done["cuts"] as unknown[]).length).toBeGreaterThan(0);
    expect(h.stored.size).toBe(1);
    const row = [...h.stored.values()][0]!;
    expect(row.rail).toBe("filler-removal-analyze");
    expect(row.result["jobId"]).toBe(a.json!["jobId"]);

    const b = await post("/remove-fillers/analyze", body);
    expect(b.status).toBe(202);
    expect(b.json?.["jobId"]).toBe(a.json!["jobId"]);
    expect(b.json?.["replayed"]).toBe(true);
    expect(h.charges).toHaveLength(1);
    expect(h.transcribeCalls).toBe(1);
  });

  it("a failed analysis refunds + voids its key and stores nothing; the retry charges fresh", async () => {
    const failBody = { ...body, mediaUrl: "https://media.example/clip-bravo.mp4" };
    h.mediaMode = "throw";
    const a = await post("/remove-fillers/analyze", failBody);
    expect(a.status).toBe(202);
    expect(h.charges).toHaveLength(1);

    await pollJob(`/remove-fillers/analyze/${a.json!["jobId"]}`, "failed");
    expect(h.refunds).toEqual([200]);
    expect(h.voids).toHaveLength(1);
    expect(h.voids[0]).toMatch(/^filler-removal-analyze:/);
    expect(h.stored.size).toBe(0);

    h.mediaMode = "ok";
    const retry = await post("/remove-fillers/analyze", failBody);
    expect(retry.status).toBe(202);
    expect(retry.json?.["jobId"]).toBe(a.json!["jobId"]);
    expect(retry.json?.["replayed"]).toBeUndefined();
    expect(h.charges).toHaveLength(2);
    await pollJob(`/remove-fillers/analyze/${a.json!["jobId"]}`, "done");
  });
});

/* ─── freeze-mask.ts — Pattern B via startJob (two products) ─────────── */

describe("freeze-mask — CA-2 replay (Pattern B)", () => {
  const freezeBody = { videoUrl: "https://media.example/freeze-alpha.mp4", timestamp: 2, holdDuration: 2 };

  it("freeze-frame: fresh mints ONE job; re-ask returns the SAME job; completion stores one row", async () => {
    const a = await post("/freeze-frame", freezeBody);
    expect(a.status).toBe(202);
    expect(a.json?.["replayed"]).toBeUndefined();
    expect(a.json?.["cost"]).toBe(150);
    expect(String(a.json?.["jobId"])).toHaveLength(32);
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(150);
    expect(h.charges[0]!.key).toMatch(/^freeze-frame:/);

    const done = await pollJob(`/freeze-mask/job/${a.json!["jobId"]}`, "done");
    expect(done["url"]).toContain("https://signed.example/");
    expect(h.stored.size).toBe(1);
    const row = [...h.stored.values()][0]!;
    expect(row.rail).toBe("freeze-frame");
    expect(row.result["jobId"]).toBe(a.json!["jobId"]);

    const b = await post("/freeze-frame", freezeBody);
    expect(b.status).toBe(202);
    expect(b.json?.["jobId"]).toBe(a.json!["jobId"]);
    expect(b.json?.["replayed"]).toBe(true);
    expect(h.charges).toHaveLength(1);
  });

  it("apply-mask is a SEPARATE product: same video, different key, different job, its own charge", async () => {
    const a = await post("/apply-mask", { videoUrl: freezeBody.videoUrl, shape: "ellipse" });
    expect(a.status).toBe(202);
    expect(a.json?.["cost"]).toBe(200);
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(200);
    expect(h.charges[0]!.key).toMatch(/^apply-mask:/);
    await pollJob(`/freeze-mask/job/${a.json!["jobId"]}`, "done");
  });

  it("a failed render refunds + voids its key and stores nothing; the retry charges fresh", async () => {
    const failBody = { videoUrl: "https://media.example/freeze-bravo.mp4", timestamp: 2, holdDuration: 2 };
    h.mediaMode = "throw";
    const a = await post("/freeze-frame", failBody);
    expect(a.status).toBe(202);
    expect(h.charges).toHaveLength(1);

    await pollJob(`/freeze-mask/job/${a.json!["jobId"]}`, "failed");
    expect(h.refunds).toEqual([150]);
    expect(h.voids).toHaveLength(1);
    expect(h.voids[0]).toMatch(/^freeze-frame:/);
    expect(h.stored.size).toBe(0);

    h.mediaMode = "ok";
    const retry = await post("/freeze-frame", failBody);
    expect(retry.status).toBe(202);
    expect(retry.json?.["jobId"]).toBe(a.json!["jobId"]);
    expect(retry.json?.["replayed"]).toBeUndefined();
    expect(h.charges).toHaveLength(2);
    await pollJob(`/freeze-mask/job/${a.json!["jobId"]}`, "done");
  });
});
