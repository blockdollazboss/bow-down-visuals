/**
 * CA-1 (Stack 400 charge audit, batch B1) — EXPOSED-REPLAY closure for
 * the media rails: aspect-convert, audio-ducking, audiogram,
 * auto-captions, auto-chapters, auto-reframe, background-removal,
 * beat-sync, bg-replacer, bg-music, beat, brand-kit, branding-shop,
 * and audio-cleanup (Pattern B — async job rail).
 *
 * Same harness family as ca1-replay-a: fake credits with keyed-charge
 * suppression, fake @workspace/db over an in-memory stored-results
 * map, a fake ffmpeg (child_process.execFile writes the output file),
 * and per-rail provider fakes. Per rail the suite pins: fresh charges
 * once + stores; identical re-ask replays the stored body with
 * replayed:true and no new charge/provider run; failure refunds AND
 * voids; the retry charges fresh.
 *
 * audio-cleanup is pinned separately: the replay returns the SAME job
 * (202, same jobId), and a failed job's refund voids its key so a
 * retry mints a NEW job with a fresh charge.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import { writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { createTestDb } from "../../lib/__tests__/test-db";
import { sql } from "drizzle-orm";
import { randomUUID } from "crypto";

/* pg-mem enforces uuid columns for real: the auth user id must be a
   uuid, and the stored-results / ledger keys embed it verbatim. */
const USER = "11111111-1111-4111-8111-111111111111";

const h = vi.hoisted(() => ({
  balance: 100_000,
  charges: [] as Array<{ amount: number; key: string }>,
  refunds: [] as number[],
  voids: [] as string[],
  chargedKeys: new Set<string>(),
  stored: new Map<string, { userId: string; rail: string; result: any }>(),
  providerCalls: 0,
  providerMode: "ok" as "ok" | "throw",
  fetchCalls: 0,
  fetchMode: "ok" as "ok" | "throw",
  ffmpegCalls: 0,
  ffmpegFail: false,
  runwayCalls: 0,
  db: null as any,
  profile: null as null | { id: string; credits: number; bonus_credits: number; bonus_credits_expires_at: string | null },
  seenKeys: new Map<string, string>(),
  mem: null as any,
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

vi.mock("../../lib/supabase-admin", () => ({
  /* In-memory profiles table for the REAL credits module: balances
     live here, keyed by user id. */
  getSupabaseAdmin: () => ({
    from: (_table: string) => {
      let mode: "select" | "update" | "insert" = "select";
      let pending: Record<string, unknown> = {};
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        update: (vals: Record<string, unknown>) => { mode = "update"; pending = vals; return chain; },
        insert: (vals: Record<string, unknown>) => { mode = "insert"; pending = vals; return chain; },
        single: async () => {
          if (mode === "update") {
            const cur = h.profile ?? { id: USER, credits: 0, bonus_credits: 0, bonus_credits_expires_at: null };
            h.profile = { ...cur, ...pending };
            return { data: null, error: null };
          }
          /* supabase .single() errors when no row matches — the real
             credits paths rely on that (readErr → OutOfCreditsError),
             so a missing profile must NOT read as a success. */
          if (!h.profile) return { data: null, error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" } };
          return { data: { ...h.profile }, error: null };
        },
        then: (res: any, rej: any) => {
          if (mode === "insert") {
            h.profile = { id: USER, credits: 0, bonus_credits: 0, bonus_credits_expires_at: null, ...(pending as any) };
          }
          return Promise.resolve({ data: null, error: null }).then(res, rej);
        },
      };
      return chain;
    },
  }),
  addCreditsToProfile: async (_userId: string, creditsToAdd: number) => {
    const cur = h.profile ?? { id: USER, credits: 0, bonus_credits: 0, bonus_credits_expires_at: null };
    const newCredits = (cur.credits ?? 0) + creditsToAdd;
    h.profile = { ...cur, credits: newCredits };
    return { oldCredits: cur.credits ?? 0, newCredits, created: false };
  },
}));

vi.mock("../../lib/admin", () => ({
  isAdminUserId: () => false,
  isAdminRequest: () => false,
}));

vi.mock("../../lib/teams", () => ({
  getUserActiveTeam: async () => null,
  deductTeamCredits: async () => { throw new Error("no team pool in this harness"); },
}));

vi.mock("../../lib/ai-clients", () => ({
  getTextModel: () => "test-model",
  LOW_REASONING_PARAMS: { reasoning_effort: "low" },
  isOpenAIConfigured: () => true,
  getOpenAI: () => ({
    chat: {
      completions: {
        create: async () => {
          h.providerCalls++;
          if (h.providerMode === "throw") throw new Error("provider down");
          const content = JSON.stringify({
            /* brand-kit */
            colors: [
              { hex: "#C9A84C", name: "Royal Gold", role: "primary" },
              { hex: "#1A1408", name: "Throne Black", role: "secondary" },
              { hex: "#F5D67B", name: "Crown Light", role: "accent" },
              { hex: "#8A7B5C", name: "Old Bronze", role: "neutral" },
              { hex: "#0D0A04", name: "Palace Night", role: "background" },
            ],
            fonts: [
              { heading: "Cinzel", body: "Inter", usage: "Headlines and body" },
              { heading: "Playfair Display", body: "Inter", usage: "Editorial" },
              { heading: "Bebas Neue", body: "Space Grotesk", usage: "Posters" },
            ],
            logoPrompt: "A gold shark crest on black",
            taglines: ["Bow Down.", "The Cheat Code.", "Royalty streams here.", "Built different.", "Your stage awaits."],
            /* auto-chapters — untimed path anchors chapters to verbatim
               phrases from the transcript */
            chapters: [
              { title: "Opening", anchor: "Alpha bravo charlie delta echo" },
              { title: "Growth", anchor: "foxtrot golf hotel india juliet" },
            ],
            /* branding-shop brief */
            logoPrompt: "A gold crown logo on black",
            tagline: "Wear the crown",
            palette: ["#C9A84C", "#1A1408"],
            mockupPrompts: { tshirt: "A gold crown tee mockup" },
            brief: "A royal kit",
          });
          return { choices: [{ message: { content } }] };
        },
      },
    },
    images: {
      generate: async () => ({ data: [{ b64_json: "aW1hZ2U=" }] }),
      edit: async () => ({ data: [{ b64_json: "aW1hZ2U=" }] }),
    },
  }),
}));

vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../lib/logger", () => ({
  logger: { info() {}, error() {}, warn() {}, debug() {} },
}));

vi.mock("../../lib/objectStorage", () => ({
  uploadMediaToSupabaseStorage: async (name: string) => `storage-ref:${name}`,
  refreshSupabaseStorageUrl: async (ref: string) => `https://signed.example/${ref}`,
  normalizeToStorageRef: (u: string) => u,
  uploadPublicMediaToR2: async (bucket: string, path: string) => `https://storage.example/${bucket}/${path}`,
}));

vi.mock("../../lib/transcription", () => ({
  transcribeAudioTimed: async () => ({
    text: "hello world this is a test",
    segments: [{ start: 0, end: 2, text: "hello world this is a test" }],
    words: [
      { word: "hello", start: 0, end: 0.5 },
      { word: "world", start: 0.5, end: 1 },
    ],
  }),
  getTimedTranscribeModel: () => "test",
  buildSegmentsFromWords: (words: any[]) => words,
}));

vi.mock("../../lib/download-to-file", () => ({
  downloadToFileCapped: async (opts: { destPath: string }) => {
    writeFileSync(opts.destPath, Buffer.from("fake-media"));
  },
}));

vi.mock("../../lib/subject-detector", () => ({
  detectSubjectsInVideo: async () => { throw new Error("detector unavailable in tests"); },
}));

vi.mock("../../lib/reframe-tracking", () => ({
  centreCropFilter: () => "crop=720:1280",
  planTrackedCrop: () => null,
}));

vi.mock("../generate/ducking-filter", () => ({
  buildDuckingMixFilter: () => "amix=inputs=2",
  duckingParamsFromSimple: () => ({}),
}));

vi.mock("../../lib/library-song", () => ({
  uuidOrNull: (v: string | null | undefined) => v ?? null,
  librarySongTitle: (name: string, suffix: string) => `${name} ${suffix}`,
  recordLibrarySong: async () => "song-cleaned-1",
}));

vi.mock("../../lib/job-map-sweeper", () => ({
  attachJobMapTtl: (map: unknown) => map,
}));

vi.mock("../../lib/payment-record", async (importOriginal) => {
  /* Keep the REAL module (credits.ts's ledger write rides it) and stub
     only the generation-history helpers the rails call. */
  const actual = await importOriginal<any>();
  return {
    ...actual,
    recordGenerationHistory: async () => "hist-1",
    markGenerationHistoryCharged: async () => {},
  };
});

vi.mock("../../lib/r2-client", () => ({
  r2Upload: async (key: string) => `https://r2.example/${key}`,
  r2PublicUrl: (key: string) => `https://r2.example/${key}`,
  r2Delete: async () => {},
  r2Download: async () => Buffer.from("x"),
}));

vi.mock("../../lib/mirrorMedia", () => ({
  mirrorExternalMediaUrl: async (u: string) => u,
}));

vi.mock("../../lib/stripe-client", () => ({
  getStripe: () => ({ checkout: { sessions: { create: async () => ({ url: "https://checkout.example/x" }) } } }),
}));

vi.mock("../../lib/embedded-checkout", () => ({}));
vi.mock("../../lib/printful", () => ({}));
vi.mock("../../lib/push-events", () => ({
  notifyUserEvent: async () => {},
}));
vi.mock("../../lib/branding-fulfillment", () => ({}));

vi.mock("@runwayml/sdk", () => ({
  default: class FakeRunway {
    textToImage = {
      create: async () => {
        h.runwayCalls++;
        if (h.providerMode === "throw") throw new Error("runway down");
        return { id: "task-1" };
      },
    };
    tasks = {
      retrieve: async () => ({ status: "SUCCEEDED", output: ["https://runway.example/img.png"] }),
    };
  },
}));

vi.mock("child_process", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const fakeExecFile = (file: string, args: string[], opts: unknown, cb?: unknown) => {
      const callback = (typeof opts === "function" ? opts : cb) as (
        err: Error | null,
        stdout: string,
        stderr: string,
      ) => void;
      if (file === "ffprobe") {
        /* Callers use three output shapes: plain `format=duration`
           with noprint_wrappers (bare number), csv stream dims
           ("1280,720"), and JSON. */
        if (args.some((a) => a.includes("csv"))) {
          callback(null, "1280,720\n", "");
          return;
        }
        if (args.some((a) => a.includes("noprint_wrappers"))) {
          callback(null, "4.0\n", "");
          return;
        }
        callback(null, JSON.stringify({
          format: { duration: "4.0" },
          streams: [{ codec_type: "video", width: 1280, height: 720 }],
        }), "");
        return;
      }
      if (file === "ffmpeg") {
        h.ffmpegCalls++;
        if (h.ffmpegFail) {
          callback(new Error("ffmpeg boom"), "", "");
          return;
        }
        /* The render output is the last FILE-looking argument: some
           calls put flags after it ("-movflags +faststart <out>
           -codec:a ..."), and analysis calls end in "-" (pipe). */
        const out = [...args].reverse().find(
          (a) => /\.(mp4|mp3|png|wav|jpg|jpeg|webm)$/i.test(a),
        );
        if (out) {
          try { writeFileSync(out, Buffer.from("fake-media-out")); } catch { /* ignore */ }
        }
        callback(null, "", [
          "RMS level dB: -18.5",
          /* signalstats for the corner color samplers */
          "[Parsed_signalstats_0 @ 0x0] YAVG:32 UAVG:128 VAVG:128",
          /* ebur128 envelope for beat-sync's beat detector: loud
             moments at ~0.5s spacing over a quiet bed */
          ...Array.from({ length: 20 }, (_, i) => {
            const t = (0.25 + i * 0.25).toFixed(3);
            const m = i % 2 === 0 ? "-8.0" : "-30.0";
            return `[Parsed_ebur128_0 @ 0x0] t: ${t}  TARGET:-23 LUFS    M:${m} S:-23.0`;
          }),
        ].join("\n"));
        return;
      }
      callback(new Error(`unexpected execFile: ${file}`), "", "");
  };
  /* Node's callback-form execFile carries a .customPromisify symbol
     slot; promisify(execFile) reads it when present. Attach our own
     so promisified callers get {stdout, stderr} from the fake. */
  const fakeAny = fakeExecFile as any;
  const sym = (Symbol as any).for?.("nodejs.util.promisify.custom") ?? Symbol.for("nodejs.util.promisify.custom");
  fakeAny[sym] = (file: string, args: string[], opts?: unknown) =>
    new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      fakeExecFile(file, args, opts ?? {}, (err: Error | null, stdout: string, stderr: string) => {
        if (err) reject(err);
        else resolve({ stdout, stderr });
      });
    });
  return { ...actual, execFile: fakeExecFile };
});

/* The REAL pg-mem database: the real credits / payment-record /
   generation-stored-results modules run against it (the hand-faked
   money stack split keys across two fake domains; the real stack is
   the house-proven harness — credits-void / ca-races-pg shape). */
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    get db() { return h.db; },
  };
});

const MONEY_DDL = `
CREATE TABLE credit_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  action text NOT NULL,
  credits_used integer NOT NULL,
  project_id uuid,
  team_id uuid,
  bonus_credits_used integer,
  bonus_expires_at timestamptz,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX credit_usage_idempotency_key_uidx ON credit_usage (idempotency_key);
CREATE TABLE generation_stored_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  rail text NOT NULL,
  idempotency_key text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX generation_stored_results_idempotency_key_uidx ON generation_stored_results (idempotency_key);
CREATE TABLE creator_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  theme_config jsonb
);
`;

/* creator_profiles seed: the row id is supplied explicitly so the
   persisted brand kit lands on a deterministic profile row. */
const PROFILE_ID = "22222222-2222-4222-8222-222222222222";

/* Re-derive the assertion trackers from the REAL ledger + stored
   table. A charge = a positive credit_usage row; a refund = its
   negative twin; a void = a charge row whose key was nulled by
   voidChargeIdempotencyKey — the key itself reads back NULL, so
   voids are recovered by diffing the keys remembered for each row id
   on earlier syncs (h.seenKeys). h.charges keeps the key the row was
   MADE with (remembered), which is what the tests assert against. */
async function rowsOf(q: ReturnType<typeof sql>) {
  const r: any = await h.db.execute(q);
  return (r?.rows ?? r) as any[];
}
async function syncTrackers() {
  const charges = await rowsOf(sql`SELECT id, credits_used AS amount, idempotency_key AS key FROM credit_usage WHERE credits_used > 0 ORDER BY credits_used`);
  const refunds = await rowsOf(sql`SELECT credits_used FROM credit_usage WHERE credits_used < 0 ORDER BY created_at`);
  const stored = await rowsOf(sql`SELECT idempotency_key FROM generation_stored_results`);
  const voids: string[] = [];
  h.charges = charges.map((c: any) => {
    const id = String(c.id);
    const liveKey = c.key == null ? null : String(c.key);
    if (liveKey) h.seenKeys.set(id, liveKey);
    const madeWith = liveKey ?? h.seenKeys.get(id) ?? "";
    if (!liveKey && h.seenKeys.has(id)) voids.push(h.seenKeys.get(id)!);
    return { amount: Number(c.amount), key: madeWith };
  });
  h.voids = voids;
  h.refunds = refunds.map((r: any) => Math.abs(Number(r.credits_used)));
  h.stored = new Map(stored.map((s: any) => [String(s.idempotency_key), {}]));
  h.balance = h.profile?.credits ?? h.balance;
}

import aspectConvertRouter from "../generate/aspect-convert";
import audioDuckingRouter from "../generate/audio-ducking";
import audiogramRouter from "../generate/audiogram";
import autoCaptionsRouter from "../generate/auto-captions";
import autoChaptersRouter from "../generate/auto-chapters";
import autoReframeRouter from "../generate/auto-reframe";
import backgroundRemovalRouter from "../generate/background-removal";
import beatSyncRouter from "../generate/beat-sync";
import bgReplacerRouter from "../generate/bg-replacer";
import bgMusicRouter from "../generate/bg-music";
import beatRouter from "../generate/beat";
import brandKitRouter from "../generate/brand-kit";
import brandingShopRouter from "../generate/branding-shop";
import audioCleanupRouter, { __clearAudioCleanupJobs } from "../generate/audio-cleanup";

const realFetch = globalThis.fetch;
let server: any;
let base = "";

function providerRuns(): number {
  return h.ffmpegCalls + h.providerCalls + h.fetchCalls + h.runwayCalls;
}

beforeAll(async () => {
  process.env["OPENAI_API_KEY"] = "test-key-not-real";
  process.env["ELEVENLABS_API_KEY"] = "test-key-not-real";
  process.env["RUNWAYML_API_SECRET"] = "test-key-not-real";
  const app = express();
  app.use(express.json());
  app.use(aspectConvertRouter);
  app.use(audioDuckingRouter);
  app.use(audiogramRouter);
  app.use(autoCaptionsRouter);
  app.use(autoChaptersRouter);
  app.use(autoReframeRouter);
  app.use(backgroundRemovalRouter);
  app.use(beatSyncRouter);
  app.use(bgReplacerRouter);
  app.use(bgMusicRouter);
  app.use(beatRouter);
  app.use(brandKitRouter);
  app.use(brandingShopRouter);
  app.use(audioCleanupRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  delete process.env["OPENAI_API_KEY"];
  delete process.env["ELEVENLABS_API_KEY"];
  delete process.env["RUNWAYML_API_SECRET"];
  vi.unstubAllGlobals();
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(async () => {
  const t = createTestDb();
  /* pg-mem has no gen_random_uuid() built in — register it (the
     drizzle defaultRandom() inserts rely on the column default). */
  t.mem.public.registerFunction({
    name: "gen_random_uuid",
    args: [],
    returns: "uuid" as never,
    impure: true,
    implementation: () => randomUUID(),
  });
  t.mem.public.none(MONEY_DDL);
  h.db = t.db; h.mem = t.mem;
  h.profile = { id: USER, credits: 100_000, bonus_credits: 0, bonus_credits_expires_at: null };
  h.seenKeys = new Map();
  await h.db.execute(sql`INSERT INTO creator_profiles (id, user_id, theme_config) VALUES (${PROFILE_ID}::uuid, ${USER}::uuid, '{}'::jsonb)`);
  h.balance = 100_000;
  h.charges = []; h.refunds = []; h.voids = [];
  h.chargedKeys = new Set();
  h.stored = new Map();
  h.providerCalls = 0; h.providerMode = "ok";
  h.fetchCalls = 0; h.fetchMode = "ok";
  h.ffmpegCalls = 0; h.ffmpegFail = false;
  h.runwayCalls = 0;
  __clearAudioCleanupJobs();
  vi.stubGlobal("fetch", vi.fn(async (url: unknown) => {
    h.fetchCalls++;
    if (h.fetchMode === "throw") {
      return { ok: false, status: 500, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
    }
    const u = String(url);
    if (u.includes("generate-music-audio")) {
      return { ok: true, status: 200, json: async () => ({ audioUrl: "https://cdn.example/music.mp3" }), arrayBuffer: async () => new ArrayBuffer(8) };
    }
    return { ok: true, status: 200, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(16) };
  }));
});

async function post(path: string, body: unknown) {
  const res = await realFetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => null)) as Record<string, any> | null };
}

const settle = () => new Promise((r) => setTimeout(r, 60));

interface RailCase {
  name: string;
  path: string;
  body: Record<string, unknown>;
  failBody: Record<string, unknown>;
  cost: number;
  rail: string;
  failMode: "ffmpeg" | "provider" | "fetch";
}

const CASES: RailCase[] = [
  {
    name: "aspect-convert", path: "/convert-aspect", cost: 150, rail: "aspect-convert", failMode: "ffmpeg",
    body: { videoUrl: "https://cdn.example/v1.mp4", ratio: "9:16" },
    failBody: { videoUrl: "https://cdn.example/v2.mp4", ratio: "9:16" },
  },
  {
    name: "audio-ducking", path: "/duck-audio", cost: 150, rail: "audio-ducking", failMode: "ffmpeg",
    body: { voiceUrl: "https://cdn.example/voice1.mp3", musicUrl: "https://cdn.example/music1.mp3" },
    failBody: { voiceUrl: "https://cdn.example/voice2.mp3", musicUrl: "https://cdn.example/music1.mp3" },
  },
  {
    name: "audiogram", path: "/audiogram", cost: 250, rail: "audiogram", failMode: "ffmpeg",
    body: { audioUrl: "https://cdn.example/a1.mp3", coverUrl: "https://cdn.example/c1.png" },
    failBody: { audioUrl: "https://cdn.example/a2.mp3", coverUrl: "https://cdn.example/c1.png" },
  },
  {
    name: "auto-captions", path: "/auto-captions", cost: 300, rail: "auto-captions", failMode: "ffmpeg",
    body: { videoUrl: "https://cdn.example/v1.mp4" },
    failBody: { videoUrl: "https://cdn.example/v2.mp4" },
  },
  {
    name: "auto-chapters", path: "/auto-chapters", cost: 150, rail: "auto-chapters", failMode: "provider",
    body: { transcript: "Alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november", totalDurationSec: 120 },
    failBody: { transcript: "Oscar papa quebec romeo sierra tango uniform victor whiskey xray yankee zulu one two", totalDurationSec: 120 },
  },
  {
    name: "auto-reframe", path: "/auto-reframe", cost: 200, rail: "auto-reframe", failMode: "ffmpeg",
    body: { videoUrl: "https://cdn.example/v1.mp4", aspect: "9:16", trackSubject: false },
    failBody: { videoUrl: "https://cdn.example/v2.mp4", aspect: "9:16", trackSubject: false },
  },
  {
    name: "background-removal", path: "/remove-background", cost: 200, rail: "background-removal", failMode: "ffmpeg",
    body: { imageUrl: "https://cdn.example/i1.png" },
    failBody: { imageUrl: "https://cdn.example/i2.png" },
  },
  {
    name: "beat-sync", path: "/beat-sync", cost: 350, rail: "beat-sync", failMode: "ffmpeg",
    body: { videoUrl: "https://cdn.example/v1.mp4", audioUrl: "https://cdn.example/a1.mp3" },
    failBody: { videoUrl: "https://cdn.example/v2.mp4", audioUrl: "https://cdn.example/a1.mp3" },
  },
  {
    name: "bg-replacer", path: "/replace-video-bg", cost: 400, rail: "bg-replacer", failMode: "ffmpeg",
    body: { videoUrl: "https://cdn.example/v1.mp4", backgroundColor: "#112233" },
    failBody: { videoUrl: "https://cdn.example/v2.mp4", backgroundColor: "#112233" },
  },
  {
    name: "bg-music", path: "/bg-music", cost: 400, rail: "bg-music", failMode: "fetch",
    body: { mood: "chill" },
    failBody: { mood: "hype" },
  },
  {
    name: "beat", path: "/beat/generate", cost: 300, rail: "beat-generate", failMode: "fetch",
    body: { vibe: "dark trap" },
    failBody: { vibe: "lofi soul" },
  },
  {
    name: "brand-kit", path: "/brand-kit", cost: 200, rail: "brand-kit", failMode: "provider",
    body: { brandName: "Bow Down Visuals", vibe: "royal gold luxury", industry: "music" },
    failBody: { brandName: "Other Brand", vibe: "street", industry: "fashion" },
  },
  {
    name: "branding-shop design", path: "/branding-shop/design", cost: 200, rail: "branding-shop-design", failMode: "provider",
    body: { brandName: "Acme", niche: "music", style: "luxury-gold", products: ["tshirt"] },
    failBody: { brandName: "Globex", niche: "music", style: "luxury-gold", products: ["tshirt"] },
  },
];

function setFail(mode: RailCase["failMode"], on: boolean) {
  if (mode === "ffmpeg") h.ffmpegFail = on;
  if (mode === "provider") h.providerMode = on ? "throw" : "ok";
  if (mode === "fetch") h.fetchMode = on ? "throw" : "ok";
}

for (const c of CASES) {
  describe(`CA-1 replay — ${c.name}`, () => {
    it("fresh charges once; identical re-ask replays from the store with no new charge or provider run", async () => {
      const a = await post(c.path, c.body);
      expect(a.status).toBe(200);
      expect(a.json?.replayed).toBeUndefined();
      await syncTrackers();
      expect(h.charges).toHaveLength(1);
      expect(h.charges[0]!.amount).toBe(c.cost);
      expect(h.charges[0]!.key.startsWith(`${c.rail}:`)).toBe(true);
      const runsAfterFresh = providerRuns();
      expect(runsAfterFresh).toBeGreaterThan(0);
      expect(h.stored.size).toBe(1);

      const b = await post(c.path, c.body);
      expect(b.status).toBe(200);
      expect(b.json?.replayed).toBe(true);
      expect(typeof b.json?.replayNote).toBe("string");
      const { replayed: _r1, replayNote: _n1, ...bRest } = b.json!;
      expect(bRest).toEqual(a.json!);
      await syncTrackers();
      expect(h.charges).toHaveLength(1);
      expect(providerRuns()).toBe(runsAfterFresh);
      expect(h.stored.size).toBe(1);
    });

    it("failure refunds AND voids; the retry charges fresh", async () => {
      setFail(c.failMode, true);
      const f = await post(c.path, c.failBody);
      await settle();
      expect(f.status).toBeGreaterThanOrEqual(400);
      await syncTrackers();
      expect(h.charges).toHaveLength(1);
      expect(h.refunds).toEqual([c.cost]);
      expect(h.voids).toEqual([h.charges[0]!.key]);
      expect(h.stored.size).toBe(0);

      setFail(c.failMode, false);
      const retry = await post(c.path, c.failBody);
      expect(retry.status).toBe(200);
      expect(retry.json?.replayed).toBeUndefined();
      await syncTrackers();
      expect(h.charges).toHaveLength(2);
      expect(h.stored.size).toBe(1);
    });
  });
}

describe("CA-1 replay — audio-cleanup (Pattern B job rail)", () => {
  async function postCleanup(bytes: string, mode = "voice") {
    const form = new FormData();
    form.append("mode", mode);
    form.append("audio", new Blob([bytes], { type: "audio/mpeg" }), "take.mp3");
    const res = await realFetch(`${base}/audio-cleanup`, { method: "POST", body: form });
    return { status: res.status, json: (await res.json().catch(() => null)) as Record<string, any> | null };
  }

  async function waitForJob(jobId: string, want: string) {
    for (let i = 0; i < 60; i++) {
      const res = await realFetch(`${base}/audio-cleanup/${jobId}`);
      const data = (await res.json()) as Record<string, any>;
      if (data.status === want || data.status === "failed") return data;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`job never reached ${want}`);
  }

  it("replay returns the SAME job with no second charge; a failed job refunds+voids and its retry mints a new job", async () => {
    const a = await postCleanup("AUDIO-BYTES-ONE");
    expect(a.status).toBe(202);
    expect(a.json?.replayed).toBeUndefined();
    const jobId = a.json!.jobId as string;
    expect(jobId).toBeTruthy();
    await syncTrackers();
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(300);

    const b = await postCleanup("AUDIO-BYTES-ONE");
    expect(b.status).toBe(202);
    expect(b.json?.jobId).toBe(jobId);
    expect(b.json?.replayed).toBe(true);
    await syncTrackers();
    expect(h.charges).toHaveLength(1);

    const done = await waitForJob(jobId, "done");
    expect(done.status).toBe("done");

    /* Failure: different bytes, ffmpeg dies → job fails, refund+void. */
    h.ffmpegFail = true;
    const f = await postCleanup("AUDIO-BYTES-TWO");
    expect(f.status).toBe(202);
    const failedJobId = f.json!.jobId as string;
    expect(failedJobId).not.toBe(jobId);
    await syncTrackers();
    expect(h.charges).toHaveLength(2);
    const failed = await waitForJob(failedJobId, "failed");
    expect(failed.status).toBe("failed");
    await settle();
    await syncTrackers();
    expect(h.refunds).toEqual([300]);
    expect(h.voids).toEqual([h.charges[1]!.key]);

    /* Retry the same bytes healthy → NEW job, fresh charge. */
    h.ffmpegFail = false;
    const retry = await postCleanup("AUDIO-BYTES-TWO");
    expect(retry.status).toBe(202);
    expect(retry.json?.jobId).not.toBe(failedJobId);
    expect(retry.json?.replayed).toBeUndefined();
    await syncTrackers();
    expect(h.charges).toHaveLength(3);
  });
});
