/**
 * CA-2 lane — replay/idempotency coverage, file B.
 * House harness shape (ca-2-replay-a.test.ts): express app over real
 * HTTP + mocked ../../lib/credits with a key-aware fake chargeCredits
 * that suppresses duplicate keys exactly like the real ledger,
 * mocked @workspace/db serving ONLY the generation_stored_results
 * select/insert chains, mocked providers.
 *
 * Covered rails (all already converted to Pattern A: server-derived
 * charge key + stored-result pre-check + refund-and-void on failure):
 *   chat rails (ai-clients mock): channel-audit, comment-replies,
 *     competitor-tracker, contract-analyzer (the ANALYZER only).
 *   ffmpeg rails (child_process execFile fake + fetch download stub):
 *     canvas, cinematic-fx. "Provider calls" for these = source-media
 *     downloads + ffmpeg/ffprobe invocations + storage uploads.
 *   Runway rail (@runwayml/sdk mock): cover-in-motion. "Provider
 *     calls" = imageToVideo.create invocations.
 *
 * Per covered rail (the house trio):
 *   1. fresh success charges exactly once, no `replayed` field,
 *      exactly one stored row;
 *   2. identical re-ask → 200, replayed:true, body deep-equals the
 *      fresh body + replayed:true, still one charge, provider call
 *      count unchanged;
 *   3. provider failure → refund issued + key voided + nothing
 *      stored; retry after failure charges fresh (2 charges total)
 *      and succeeds. Every rail in this file carries its own
 *      failure leg.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";

const USER = "user-1";

const h = vi.hoisted(() => ({
  balance: 100_000,
  charges: [] as Array<{ amount: number; key: string }>,
  refunds: [] as number[],
  voids: [] as string[],
  chargedKeys: new Set<string>(),
  stored: new Map<string, { userId: string; rail: string; result: any }>(),
  chatCalls: 0,
  aiMode: "ok" as "ok" | "throw",
  fetchCalls: 0,
  fetchMode: "ok" as "ok" | "throw",
  execCalls: 0,
  uploads: 0,
  historyCalls: 0,
  runwayCreate: 0,
  runwayRetrieve: 0,
  runwayMode: "ok" as "ok" | "throw",
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
    refundCreditsGuaranteed: async (_userId: string, amount: number, _meta: unknown, opts?: { idempotencyKey?: string | null }) => {
      /* Faithful mirror of the real helper against this fake ledger:
         refund, void only when the refund landed, exactly one retry. */
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          h.balance += amount;
          h.refunds.push(amount);
          if (opts?.idempotencyKey) {
            h.voids.push(opts.idempotencyKey);
            h.chargedKeys.delete(opts.idempotencyKey);
          }
          return true;
        } catch { /* the real helper retries exactly once */ }
      }
      return false;
    },
    voidChargeIdempotencyKey: async (key: string) => {
      h.voids.push(key);
      return h.chargedKeys.delete(key);
    },
  };
});

/* One superset provider payload — every chat rail in this file
   parses the fields it needs out of the same JSON shape. */
const SUPERSET = {
  /* channel-audit */
  overallGrade: "B",
  overallScore: 78,
  verdict: "Solid foundation, weak hooks. Your branding carries you.",
  disclaimer: "Based on what you shared and current best practices — not a guarantee of growth.",
  dimensions: [
    { key: "posting-consistency", grade: "A", score: 92, finding: "You post 4x weekly like clockwork.", fix: "Keep the cadence; batch-film on Sundays." },
    { key: "hook-strength", grade: "C", score: 58, finding: "Captions start with announcements, not hooks.", fix: "Lead every caption with a curiosity gap." },
    { key: "branding", grade: "B", score: 80, finding: "Gold/black identity is consistent.", fix: "Add the crown motif to thumbnails too." },
    { key: "caption-quality", grade: "C", score: 61, finding: "Captions describe, they don't sell.", fix: "End every caption with a question." },
    { key: "cta-usage", grade: "D", score: 35, finding: "No CTAs in the last 10 posts.", fix: "Add one comment-bait CTA per post." },
    { key: "profile-bio", grade: "B", score: 76, finding: "Bio states niche clearly.", fix: "Add a pinned-link CTA line to the bio." },
  ],
  topPriorities: ["Add a CTA to every post.", "Rewrite first lines as hooks.", "Pin your best post."],
  /* comment-replies (exactly one per comment in the request below) */
  replies: ["Love it — thanks for listening! What's your favorite track?", "Appreciate you! Which beat should we flip next?"],
  /* competitor-tracker */
  contentPillars: [
    { pillar: "Tutorials", whatTheyPost: "Weekly mixing breakdowns." },
    { pillar: "Beat flips", whatTheyPost: "Sample flip challenges." },
    { pillar: "Studio life", whatTheyPost: "Behind-the-scenes clips." },
  ],
  postingCadence: { assessment: "Posts steadily, roughly daily on weekdays.", estimatedPostsPerWeek: 5 },
  topFormats: [
    { format: "Tutorial", whyItWorks: "Saves and shares." },
    { format: "Duet reaction", whyItWorks: "Borrows bigger audiences." },
    { format: "Before/after", whyItWorks: "Instant proof of skill." },
  ],
  strengths: ["Consistent cadence"],
  weaknesses: ["Weak CTAs"],
  opportunities: [
    { gap: "No live sessions", howToExploit: "Go live weekly." },
    { gap: "No captions series", howToExploit: "Start a caption teardown series." },
    { gap: "No community posts", howToExploit: "Poll fans on the next flip." },
  ],
  takeaways: ["Steal the tutorial format.", "Out-post them on weekends.", "Own the live slot they ignore."],
  /* contract-analyzer (returned verbatim as `analysis`) */
  riskScore: 42,
  riskLevel: "moderate",
  summary: "A standard brand deal with a few watch-outs.",
};

vi.mock("../../lib/ai-clients", () => ({
  getTextModel: () => "test-model",
  LOW_REASONING_PARAMS: { reasoning_effort: "low" },
  getOpenAI: () => ({
    chat: {
      completions: {
        create: async () => {
          h.chatCalls++;
          if (h.aiMode === "throw") throw new Error("provider down");
          return { choices: [{ message: { content: JSON.stringify(SUPERSET) } }] };
        },
      },
    },
    images: {
      generate: async () => ({ data: [{ b64_json: "aW1hZ2UtYnl0ZXM=" }] }),
      edit: async () => ({ data: [{ b64_json: "aW1hZ2UtYnl0ZXM=" }] }),
    },
  }),
}));

vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../lib/logger", () => ({
  logger: { info() {}, warn() {}, error() {} },
}));

vi.mock("../../lib/objectStorage", () => ({
  uploadMediaToSupabaseStorage: async (objectName: string) => {
    h.uploads++;
    return `storage-ref:${objectName}`;
  },
  refreshSupabaseStorageUrl: async (ref: string) => `https://signed.example/${ref}`,
  uploadPublicMediaFileToR2: async (_bucket: string, path: string) => {
    h.uploads++;
    return `https://r2.example/${path}`;
  },
  normalizeToStorageRef: (u: string) => u,
}));

vi.mock("../../lib/payment-record", () => ({
  recordCanvasHistory: async () => { h.historyCalls++; },
  recordCreditUsage: async () => {},
  recordGenerationHistory: async () => "gen-hist-1",
  markGenerationHistoryCharged: async () => {},
}));

/* ffmpeg/ffprobe fake for the canvas + cinematic-fx rails: every
   ffmpeg invocation "renders" by writing dummy bytes to its output
   path (the last argument); ffprobe answers plausible dimensions —
   the `csv=p=0` form cinematic-fx asks for, the key=value form
   canvas asks for. */
vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const fs = await import("node:fs");
  const { promisify } = await import("node:util");
  const runFake = (file: string, args: unknown[]): { stdout: string; stderr: string } => {
    h.execCalls++;
    if (file === "ffprobe") {
      const isCsv = (args as unknown[]).some((a) => String(a).includes("csv"));
      return { stdout: isCsv ? "720,1280\n" : "width=720\nheight=1280\ncodec_name=h264\nduration=8.0\n", stderr: "" };
    }
    const out = String((args as unknown[])[(args as unknown[]).length - 1]);
    try { fs.writeFileSync(out, Buffer.from("fake-video-bytes")); } catch { /* readFile surfaces it */ }
    return { stdout: "", stderr: "" };
  };
  const execFile = (file: string, args: unknown[], ...rest: unknown[]) => {
    const cb = rest[rest.length - 1] as (err: Error | null, stdout: string, stderr: string) => void;
    const { stdout, stderr } = runFake(file, args);
    cb(null, stdout, stderr);
  };
  /* The routes promisify(execFile) at module load; a plain fake
     would resolve with the bare stdout string instead of
     { stdout, stderr }, so give it a promisify.custom twin. */
  (execFile as unknown as Record<symbol, unknown>)[promisify.custom] =
    async (file: string, args: unknown[]) => runFake(file, args);
  return { ...actual, execFile };
});

/* Runway SDK fake for cover-in-motion: create returns a task whose
   first retrieve already SUCCEEDED (so no poll sleeps). */
vi.mock("@runwayml/sdk", () => ({
  default: class FakeRunway {
    imageToVideo = {
      create: async () => {
        h.runwayCreate++;
        if (h.runwayMode === "throw") throw new Error("runway down");
        return { id: "task-1" };
      },
    };
    tasks = {
      retrieve: async () => {
        h.runwayRetrieve++;
        return { status: "SUCCEEDED", output: ["https://runway.example/out.mp4"] };
      },
    };
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
  };
  return { ...actual, db: fakeDb };
});

import canvasRouter from "../generate/canvas";
import channelAuditRouter from "../generate/channel-audit";
import cinematicFxRouter from "../generate/cinematic-fx";
import commentRepliesRouter from "../generate/comment-replies";
import competitorTrackerRouter from "../generate/competitor-tracker";
import contractAnalyzerRouter from "../generate/contract-analyzer";
import coverInMotionRouter from "../generate/cover-in-motion";

let base = "";
let server: ReturnType<express.Express["listen"]>;
const realFetch = globalThis.fetch;

beforeAll(async () => {
  process.env["RUNWAYML_API_SECRET"] = "test-key-not-real";
  const app = express();
  app.use(express.json());
  app.use(canvasRouter);
  app.use(channelAuditRouter);
  app.use(cinematicFxRouter);
  app.use(commentRepliesRouter);
  app.use(competitorTrackerRouter);
  app.use(contractAnalyzerRouter);
  app.use(coverInMotionRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  delete process.env["RUNWAYML_API_SECRET"];
  vi.unstubAllGlobals();
  await new Promise((r) => server.close(r));
});

beforeEach(() => {
  h.balance = 100_000;
  h.charges = []; h.refunds = []; h.voids = [];
  h.chargedKeys = new Set();
  h.stored = new Map();
  h.chatCalls = 0;
  h.aiMode = "ok";
  h.fetchCalls = 0;
  h.fetchMode = "ok";
  h.execCalls = 0;
  h.uploads = 0;
  h.historyCalls = 0;
  h.runwayCreate = 0; h.runwayRetrieve = 0;
  h.runwayMode = "ok";
  vi.stubGlobal("fetch", vi.fn(async (url: unknown) => {
    h.fetchCalls++;
    if (String(url) === "https://runway.example/out.mp4") {
      /* cover-in-motion downloads the rendered clip as a stream. */
      return { ok: true, status: 200, body: Readable.from([Buffer.from("fake-clip-bytes")]) };
    }
    if (h.fetchMode === "throw") {
      return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
    }
    return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer };
  }));
});

async function post(path: string, body?: unknown) {
  const res = await realFetch(`${base}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => null)) as Record<string, any> | null };
}

/* ─── Chat rails: the generic house trio ─────────────────────────── */

interface RailCase {
  name: string;
  rail: string;
  path: string;
  body: unknown;
  failStatus: number;
}

const CHAT_RAILS: RailCase[] = [
  {
    name: "channel-audit", rail: "channel-audit", path: "/channel-audit",
    body: { niche: "music production", handle: "testcreator", platform: "tiktok", bio: "I make beats.", postsPerWeek: "3", recentPosts: ["new single out now"] },
    failStatus: 502,
  },
  {
    name: "comment-replies", rail: "comment-replies", path: "/comment-replies",
    body: { comments: ["love this track", "great beat"], tone: "hype", voiceNotes: "" },
    failStatus: 502,
  },
  {
    name: "competitor-tracker", rail: "competitor-tracker", path: "/competitor-analysis",
    body: { competitorName: "Rival Beats", channelUrl: "", niche: "music production", notes: "posts daily tutorials" },
    failStatus: 502,
  },
  {
    name: "contract-analyzer", rail: "contract-analyzer", path: "/analyze",
    body: {
      contractText: "BRAND DEAL AGREEMENT. This agreement is between the Brand and the Creator. The Brand will pay the Creator a fee for sponsored posts. The term is twelve months. The Creator grants the Brand a license to repost the sponsored content on its own channels during the term. Payment is due within thirty days of posting.",
      contractType: "brand-deal",
      context: "",
    },
    failStatus: 500,
  },
];

for (const rc of CHAT_RAILS) {
  describe(`${rc.name} — CA-2 replay (Pattern A)`, () => {
    it("fresh success charges exactly once, no replayed field, exactly one stored row", async () => {
      const a = await post(rc.path, rc.body);
      expect(a.status).toBe(200);
      expect(a.json?.["replayed"]).toBeUndefined();
      expect(h.charges).toHaveLength(1);
      expect(h.charges[0]!.key).toMatch(new RegExp(`^${rc.rail}:user-1:`));
      expect(h.chatCalls).toBe(1);
      expect(h.stored.size).toBe(1);
      const row = [...h.stored.values()][0]!;
      expect(row.rail).toBe(rc.rail);
      expect(row.result).toEqual(a.json);
    });

    it("identical re-ask → 200 replayed:true, still one charge, provider count unchanged", async () => {
      const a = await post(rc.path, rc.body);
      expect(a.status).toBe(200);
      const b = await post(rc.path, rc.body);
      expect(b.status).toBe(200);
      expect(b.json?.["replayed"]).toBe(true);
      expect(b.json).toEqual({ ...a.json, replayed: true });
      expect(h.charges).toHaveLength(1);
      expect(h.chatCalls).toBe(1);
      expect(h.stored.size).toBe(1);
    });

    it("provider failure refunds + voids the key + stores nothing; retry charges fresh and succeeds", async () => {
      h.aiMode = "throw";
      const failed = await post(rc.path, rc.body);
      expect(failed.status).toBe(rc.failStatus);
      expect(h.refunds).toHaveLength(1);
      expect(h.voids).toHaveLength(1);
      expect(h.voids[0]).toMatch(new RegExp(`^${rc.rail}:user-1:`));
      expect(h.stored.size).toBe(0);

      h.aiMode = "ok";
      const retry = await post(rc.path, rc.body);
      expect(retry.status).toBe(200);
      expect(retry.json?.["replayed"]).toBeUndefined();
      expect(h.charges).toHaveLength(2); // failed attempt + fresh retry charge
      expect(h.stored.size).toBe(1);
    });
  });
}

/* ─── canvas (ffmpeg rail) ───────────────────────────────────────── */

describe("canvas — CA-2 replay (Pattern A, ffmpeg)", () => {
  const body = { coverUrl: "https://media.example/cover.jpg", style: "zoom" };
  const workCalls = () => ({ fetch: h.fetchCalls, exec: h.execCalls, uploads: h.uploads, history: h.historyCalls });

  it("fresh success charges exactly once, no replayed field, exactly one stored row", async () => {
    const a = await post("/canvas/generate", body);
    expect(a.status).toBe(200);
    expect(a.json?.["replayed"]).toBeUndefined();
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.key).toMatch(/^canvas:user-1:/);
    expect(h.fetchCalls).toBe(1); // cover download only (no audioUrl)
    expect(h.execCalls).toBe(3); // ffmpeg pass 1 + ffmpeg pass 2 + ffprobe
    expect(h.uploads).toBe(1);
    expect(h.historyCalls).toBe(1);
    expect(h.stored.size).toBe(1);
    const row = [...h.stored.values()][0]!;
    expect(row.rail).toBe("canvas");
    expect(row.result).toEqual(a.json);
  });

  it("identical re-ask → 200 replayed:true, still one charge, no second render/download/history row", async () => {
    const a = await post("/canvas/generate", body);
    expect(a.status).toBe(200);
    const before = workCalls();
    const b = await post("/canvas/generate", body);
    expect(b.status).toBe(200);
    expect(b.json?.["replayed"]).toBe(true);
    expect(b.json).toEqual({ ...a.json, replayed: true });
    expect(h.charges).toHaveLength(1);
    expect(workCalls()).toEqual(before);
    expect(h.stored.size).toBe(1);
  });

  it("provider failure (cover download) refunds + voids the key + stores nothing; retry charges fresh and succeeds", async () => {
    h.fetchMode = "throw";
    const failed = await post("/canvas/generate", body);
    expect(failed.status).toBe(500);
    expect(h.refunds).toHaveLength(1);
    expect(h.voids).toHaveLength(1);
    expect(h.voids[0]).toMatch(/^canvas:user-1:/);
    expect(h.stored.size).toBe(0);

    h.fetchMode = "ok";
    const retry = await post("/canvas/generate", body);
    expect(retry.status).toBe(200);
    expect(retry.json?.["replayed"]).toBeUndefined();
    expect(h.charges).toHaveLength(2);
    expect(h.stored.size).toBe(1);
  });
});

/* ─── cinematic-fx (ffmpeg rail) ─────────────────────────────────── */

describe("cinematic-fx — CA-2 replay (Pattern A, ffmpeg)", () => {
  const body = { videoUrl: "https://media.example/clip.mp4", effects: ["Film Grain"], intensity: 60, attribution: false };
  const workCalls = () => ({ fetch: h.fetchCalls, exec: h.execCalls, uploads: h.uploads });

  it("fresh success charges exactly once, no replayed field, exactly one stored row", async () => {
    const a = await post("/cinematic-fx", body);
    expect(a.status).toBe(200);
    expect(a.json?.["replayed"]).toBeUndefined();
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.key).toMatch(/^cinematic-fx:user-1:/);
    expect(h.fetchCalls).toBe(1); // source video download
    expect(h.execCalls).toBe(2); // ffprobe + final ffmpeg render (Film Grain needs no overlay renders)
    expect(h.uploads).toBe(1);
    expect(h.stored.size).toBe(1);
    const row = [...h.stored.values()][0]!;
    expect(row.rail).toBe("cinematic-fx");
    expect(row.result).toEqual(a.json);
  });

  it("identical re-ask → 200 replayed:true, still one charge, no second render/download", async () => {
    const a = await post("/cinematic-fx", body);
    expect(a.status).toBe(200);
    const before = workCalls();
    const b = await post("/cinematic-fx", body);
    expect(b.status).toBe(200);
    expect(b.json?.["replayed"]).toBe(true);
    expect(b.json).toEqual({ ...a.json, replayed: true });
    expect(h.charges).toHaveLength(1);
    expect(workCalls()).toEqual(before);
    expect(h.stored.size).toBe(1);
  });

  it("provider failure (video download) refunds + voids the key + stores nothing; retry charges fresh and succeeds", async () => {
    h.fetchMode = "throw";
    const failed = await post("/cinematic-fx", body);
    expect(failed.status).toBe(500);
    expect(h.refunds).toHaveLength(1);
    expect(h.voids).toHaveLength(1);
    expect(h.voids[0]).toMatch(/^cinematic-fx:user-1:/);
    expect(h.stored.size).toBe(0);

    h.fetchMode = "ok";
    const retry = await post("/cinematic-fx", body);
    expect(retry.status).toBe(200);
    expect(retry.json?.["replayed"]).toBeUndefined();
    expect(h.charges).toHaveLength(2);
    expect(h.stored.size).toBe(1);
  });
});

/* ─── cover-in-motion (Runway rail) ──────────────────────────────── */

describe("cover-in-motion — CA-2 replay (Pattern A, Runway)", () => {
  const body = { imageUrl: "https://media.example/cover.jpg", style: "lofi glow", durationSec: 5 };
  const workCalls = () => ({ create: h.runwayCreate, retrieve: h.runwayRetrieve, fetch: h.fetchCalls, uploads: h.uploads });

  it("fresh success charges exactly once, no replayed field, exactly one stored row", async () => {
    const a = await post("/cover-in-motion/animate", body);
    expect(a.status).toBe(200);
    expect(a.json?.["replayed"]).toBeUndefined();
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.key).toMatch(/^cover-in-motion:user-1:/);
    expect(h.runwayCreate).toBe(1);
    expect(h.runwayRetrieve).toBe(1);
    expect(h.fetchCalls).toBe(1); // rendered-clip download
    expect(h.uploads).toBe(1);
    expect(h.stored.size).toBe(1);
    const row = [...h.stored.values()][0]!;
    expect(row.rail).toBe("cover-in-motion");
    expect(row.result).toEqual(a.json);
  });

  it("identical re-ask → 200 replayed:true, still one charge, no second Runway task", async () => {
    const a = await post("/cover-in-motion/animate", body);
    expect(a.status).toBe(200);
    const before = workCalls();
    const b = await post("/cover-in-motion/animate", body);
    expect(b.status).toBe(200);
    expect(b.json?.["replayed"]).toBe(true);
    expect(b.json).toEqual({ ...a.json, replayed: true });
    expect(h.charges).toHaveLength(1);
    expect(workCalls()).toEqual(before);
    expect(h.stored.size).toBe(1);
  });

  it("provider failure (Runway create) refunds + voids the key + stores nothing; retry charges fresh and succeeds", async () => {
    h.runwayMode = "throw";
    const failed = await post("/cover-in-motion/animate", body);
    expect(failed.status).toBe(502);
    expect(failed.json?.["refunded"]).toBe(true);
    expect(h.refunds).toHaveLength(1);
    expect(h.voids).toHaveLength(1);
    expect(h.voids[0]).toMatch(/^cover-in-motion:user-1:/);
    expect(h.stored.size).toBe(0);

    h.runwayMode = "ok";
    const retry = await post("/cover-in-motion/animate", body);
    expect(retry.status).toBe(200);
    expect(retry.json?.["replayed"]).toBeUndefined();
    expect(h.charges).toHaveLength(2);
    expect(h.stored.size).toBe(1);
  });
});
