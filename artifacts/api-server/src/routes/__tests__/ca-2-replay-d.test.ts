/**
 * CA-2 lane — replay/idempotency coverage, file D.
 * House harness shape (ca-2-replay-a.test.ts): express app over real
 * HTTP + mocked ../../lib/credits with a key-aware fake chargeCredits
 * that suppresses duplicate keys exactly like the real ledger,
 * mocked @workspace/db serving the generation_stored_results
 * select/insert chains (plus, for hum-to-song only, the
 * hum_recordings row chains), mocked providers.
 *
 * Covered rails (all already converted to Pattern A: server-derived
 * charge key + stored-result pre-check + refund-and-void on failure):
 *   content-calendar, cover-art (chat + image providers),
 *   email-list POST /email-list/newsletter ONLY (the :780 AI-copy
 *     site; rail key scope "email-list-newsletter" — the file's other
 *     handlers are not converted and are not exercised here),
 *   hashtags (direct OpenAI fetch rail),
 *   hook-studio in all three modes (hooks / captions / preflight —
 *     the mode rides the intent, so each mode is its own rail case),
 *   hum-to-song (ElevenLabs fetch rail, humRef consumption path).
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
 *
 * hum-to-song carries the lane's special assertion: the stored
 * pre-check runs BEFORE the hum is resolved/consumed — after a
 * landed generation, the hum row is deleted from the fake DB and
 * the identical re-ask is still served (200, replayed:true) instead
 * of 404ing at hum resolution, with no re-download, no second
 * provider call, and no second hum-row update.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const USER = "user-1";
const HUM_ID = "11111111-1111-4111-8111-111111111111";

const HUM_ANALYSIS = {
  tempoBpm: 120,
  keyEstimate: "C major",
  durationSec: 12,
  noteCount: 24,
};

const h = vi.hoisted(() => ({
  balance: 100_000,
  charges: [] as Array<{ amount: number; key: string }>,
  refunds: [] as number[],
  voids: [] as string[],
  chargedKeys: new Set<string>(),
  stored: new Map<string, { userId: string; rail: string; result: any }>(),
  chatCalls: 0,
  imageCalls: 0,
  aiMode: "ok" as "ok" | "throw",
  fetchCalls: 0,
  r2Uploads: 0,
  r2Downloads: 0,
  humRow: null as null | { id: string; audioRef: string; audioUrl: string | null; analysis: unknown },
  humUpdates: 0,
  elUploadCalls: 0,
  elMusicCalls: 0,
  elMode: "ok" as "ok" | "throw",
  historyCalls: 0,
  libraryCalls: 0,
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

/* One superset provider payload — every chat rail in this file
   parses the fields it needs out of the same JSON shape. */
const SUPERSET = {
  /* content-calendar: 30 days, posting days on even indexes */
  days: Array.from({ length: 30 }, (_, i) =>
    i % 2 === 0
      ? { post: true, title: `Post idea ${i + 1}`, format: "video", platform: "tiktok", hook: `Hook line ${i + 1}`, bestTime: "6:00 PM" }
      : { post: false },
  ),
  /* cover-art art direction */
  concept: "A crown of gold light over a midnight skyline.",
  typography: "Title dead-center in bold stacked capitals.",
  palette: ["#112233", "#445566", "#778899"],
  /* email-list newsletter draft */
  subject: "November update: new single out Friday",
  body: "Hello fans — the new single drops Friday. Thank you for riding with us.",
  /* hook-studio (all three modes) */
  hooks: ["Hook one", "Hook two", "Hook three", "Hook four", "Hook five"],
  captions: ["Caption one", "Caption two", "Caption three"],
  hashtags: { niche: ["bedroompop"], broad: ["newmusic"], trending: ["fypchallenge"] },
  cta: "Comment your city below.",
  score: 82,
  verdict: "Ready to post.",
  disclaimer: "A readiness score, not a virality guarantee — no AI can predict what blows up.",
  checks: [{ label: "Hook strength", score: 90, fix: "Trim the first line." }],
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
      generate: async () => {
        h.imageCalls++;
        if (h.aiMode === "throw") throw new Error("provider down");
        return { data: [{ b64_json: "aW1hZ2UtYnl0ZXM=" }] };
      },
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

vi.mock("../../lib/admin", () => ({
  isAdminUserId: () => false,
}));

/* email-list's non-newsletter collaborators — stubbed so the router
   loads cleanly; none of them run on the newsletter path. */
vi.mock("../../lib/email-campaign-sender", () => ({
  queueWelcomeSequence: async () => {},
}));
vi.mock("../../lib/email", () => ({
  EMAIL_LOGO_URL: "https://example.com/logo.png",
}));
vi.mock("../../lib/email-campaign-send", () => ({
  dispatchCampaign: async () => {},
}));
vi.mock("../../lib/email-automations", () => ({
  ensureAutomationsForList: async () => [],
  automationDto: (x: unknown) => x,
}));
vi.mock("../../lib/email-automation-i18n", () => ({
  resolveAutomationLocale: () => "en",
}));
vi.mock("../../lib/email-segments", () => ({
  autoTagsFor: () => [],
  evaluateSegment: () => [],
  loadListFacts: async () => ({}),
  normalizeCriteria: (x: unknown) => x,
  parseStoredCriteria: () => ({}),
}));

vi.mock("../../lib/r2-client", () => ({
  r2Upload: async (key: string) => {
    h.r2Uploads++;
    return `https://r2.example/${key}`;
  },
  r2PublicUrl: (key: string) => `https://r2.example/${key}`,
  r2Download: async () => {
    h.r2Downloads++;
    return Buffer.from("hum-audio-bytes");
  },
}));

vi.mock("../../lib/payment-record", () => ({
  recordCreditUsage: async () => {},
  recordGenerationHistory: async () => { h.historyCalls++; return "gen-hist-1"; },
  markGenerationHistoryCharged: async () => {},
  recordCanvasHistory: async () => {},
}));

vi.mock("../../lib/melody-analysis", () => ({
  analyzeMelody: async () => HUM_ANALYSIS,
}));

vi.mock("../../lib/library-song", () => ({
  recordLibrarySong: async () => { h.libraryCalls++; return "lib-song-1"; },
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const fakeDb = {
    select: () => ({
      from: (table: unknown) => ({
        where: (cond: unknown) => ({
          limit: async () => {
            if (table === actual.humRecordingsTable) {
              return h.humRow ? [h.humRow] : [];
            }
            const key = keyFromCondition(cond);
            const row = key !== null ? h.stored.get(key) : undefined;
            return row ? [row] : [];
          },
        }),
      }),
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        onConflictDoNothing: async () => {
          const key = v["idempotencyKey"] as string | undefined;
          if (key && !h.stored.has(key)) {
            h.stored.set(key, { userId: v["userId"] as string, rail: v["rail"] as string, result: v["result"] });
          }
          return [];
        },
        returning: async () => {
          /* hum_recordings insert (storeHum) — not exercised by the
             humRef path, kept faithful for completeness. */
          const row = {
            id: HUM_ID,
            audioRef: v["audioRef"] as string,
            audioUrl: (v["audioUrl"] as string | null) ?? null,
            analysis: v["analysis"],
          };
          h.humRow = row;
          return [row];
        },
      }),
    }),
    update: () => ({
      set: () => ({
        where: async () => { h.humUpdates++; return []; },
      }),
    }),
    delete: () => ({ where: async () => [] }),
  };
  return { ...actual, db: fakeDb };
});

import contentCalendarRouter from "../generate/content-calendar";
import coverArtRouter from "../generate/cover-art";
import emailListRouter from "../generate/email-list";
import hashtagsRouter from "../generate/hashtags";
import hookStudioRouter from "../generate/hook-studio";
import humToSongRouter from "../generate/hum-to-song";

let base = "";
let server: ReturnType<express.Express["listen"]>;
const realFetch = globalThis.fetch;

const HASHTAG_PAYLOAD = {
  high: ["#Music", "#Viral"],
  medium: ["#IndieMusic"],
  niche: ["#BedroomPop"],
};

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(contentCalendarRouter);
  app.use(coverArtRouter);
  app.use(emailListRouter);
  app.use(hashtagsRouter);
  app.use(hookStudioRouter);
  app.use(humToSongRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await new Promise((r) => server.close(r));
});

function resetState() {
  h.balance = 100_000;
  h.charges = []; h.refunds = []; h.voids = [];
  h.chargedKeys = new Set();
  h.stored = new Map();
  h.chatCalls = 0; h.imageCalls = 0;
  h.aiMode = "ok";
  h.fetchCalls = 0;
  h.r2Uploads = 0; h.r2Downloads = 0;
  h.humRow = { id: HUM_ID, audioRef: "hum/user-1/hum.mp3", audioUrl: "https://r2.example/hum/user-1/hum.mp3", analysis: HUM_ANALYSIS };
  h.humUpdates = 0;
  h.elUploadCalls = 0; h.elMusicCalls = 0;
  h.elMode = "ok";
  h.historyCalls = 0; h.libraryCalls = 0;
}

beforeEach(() => {
  resetState();
  vi.stubGlobal("fetch", vi.fn(async (url: unknown) => {
    const u = String(url);
    if (u.includes("elevenlabs.io/v1/music/upload")) {
      h.elUploadCalls++;
      /* Conditioning upload is enterprise-gated on this fake account:
         not-ok → the route degrades to the text-prompt compose. */
      return { ok: false, status: 403, json: async () => ({}) };
    }
    if (u.includes("elevenlabs.io/v1/music")) {
      h.elMusicCalls++;
      if (h.elMode === "throw") {
        return { ok: false, status: 500, text: async () => "elevenlabs boom", arrayBuffer: async () => new ArrayBuffer(0) };
      }
      return { ok: true, status: 200, text: async () => "", arrayBuffer: async () => new Uint8Array([9, 9, 9]).buffer };
    }
    /* Direct OpenAI fetch (hashtags rail). */
    h.fetchCalls++;
    if (h.aiMode === "throw") return { ok: false, status: 500, json: async () => ({}) };
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: JSON.stringify(HASHTAG_PAYLOAD) } }] }),
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

/* ─── Generic rails: the house trio ──────────────────────────────── */

interface RailCase {
  name: string;
  rail: string; // charge-key scope (also the stored row's rail)
  path: string;
  body: unknown;
  providerCalls: () => number;
  freshProviderCalls: number;
  failStatus: number;
  setFailure: () => void;
  clearFailure: () => void;
}

const chatFail = { setFailure: () => { h.aiMode = "throw"; }, clearFailure: () => { h.aiMode = "ok"; } };

const RAILS: RailCase[] = [
  {
    name: "content-calendar", rail: "content-calendar", path: "/content-calendar",
    body: { niche: "music production", platforms: ["tiktok"], postsPerWeek: 3, startDate: "2026-11-10" },
    providerCalls: () => h.chatCalls, freshProviderCalls: 1, failStatus: 502, ...chatFail,
  },
  {
    name: "cover-art", rail: "cover-art", path: "/cover-art",
    body: { songTitle: "Midnight Crown", artistName: "Thy Cheat Code", mood: "dark hip-hop", style: "luxury-gold", aspectRatio: "1:1", tier: "standard" },
    /* Two provider calls on the fresh path: art-direction chat + image generation. */
    providerCalls: () => h.chatCalls + h.imageCalls, freshProviderCalls: 2, failStatus: 500, ...chatFail,
  },
  {
    name: "email-list newsletter (AI copy)", rail: "email-list-newsletter", path: "/email-list/newsletter",
    body: { topic: "new single out Friday", tone: "hype", creatorName: "Thy Cheat Code", listName: "The Inner Circle", callToAction: "Stream it now" },
    providerCalls: () => h.chatCalls, freshProviderCalls: 1, failStatus: 502, ...chatFail,
  },
  {
    name: "hashtags", rail: "hashtags", path: "/hashtags",
    body: { topic: "bedroom pop mixing tips", platform: "tiktok" },
    providerCalls: () => h.fetchCalls, freshProviderCalls: 1, failStatus: 500, ...chatFail,
  },
  {
    name: "hook-studio (hooks mode)", rail: "hook-studio", path: "/hook-studio",
    body: { mode: "hooks", videoType: "tutorial", topic: "mixing vocals" },
    providerCalls: () => h.chatCalls, freshProviderCalls: 1, failStatus: 502, ...chatFail,
  },
  {
    name: "hook-studio (captions mode)", rail: "hook-studio", path: "/hook-studio",
    body: { mode: "captions", topic: "new single dropping Friday", platform: "tiktok", tone: "bold" },
    providerCalls: () => h.chatCalls, freshProviderCalls: 1, failStatus: 502, ...chatFail,
  },
  {
    name: "hook-studio (preflight mode)", rail: "hook-studio", path: "/hook-studio",
    body: { mode: "preflight", title: "My new song in 30 seconds", caption: "full breakdown", hashtags: "#music", description: "studio session" },
    providerCalls: () => h.chatCalls, freshProviderCalls: 1, failStatus: 502, ...chatFail,
  },
];

for (const rc of RAILS) {
  describe(`${rc.name} — CA-2 replay (Pattern A)`, () => {
    it("fresh success charges exactly once, no replayed field, exactly one stored row", async () => {
      const a = await post(rc.path, rc.body);
      expect(a.status).toBe(200);
      expect(a.json?.["replayed"]).toBeUndefined();
      expect(h.charges).toHaveLength(1);
      expect(h.charges[0]!.key).toMatch(new RegExp(`^${rc.rail}:user-1:`));
      expect(rc.providerCalls()).toBe(rc.freshProviderCalls);
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
      expect(rc.providerCalls()).toBe(rc.freshProviderCalls);
      expect(h.stored.size).toBe(1);
    });

    it("provider failure refunds + voids the key + stores nothing; retry charges fresh and succeeds", async () => {
      rc.setFailure();
      const failed = await post(rc.path, rc.body);
      expect(failed.status).toBe(rc.failStatus);
      expect(h.refunds).toHaveLength(1);
      expect(h.voids).toHaveLength(1);
      expect(h.voids[0]).toMatch(new RegExp(`^${rc.rail}:user-1:`));
      expect(h.stored.size).toBe(0);

      rc.clearFailure();
      const retry = await post(rc.path, rc.body);
      expect(retry.status).toBe(200);
      expect(retry.json?.["replayed"]).toBeUndefined();
      expect(h.charges).toHaveLength(2); // failed attempt + fresh retry charge
      expect(h.stored.size).toBe(1);
    });
  });
}

/* ─── hum-to-song (special: pre-check BEFORE hum consumption) ────── */

describe("hum-to-song — CA-2 replay (Pattern A, humRef path)", () => {
  const body = { humRef: HUM_ID, mode: "simple" };
  const workCalls = () => ({
    elUpload: h.elUploadCalls, elMusic: h.elMusicCalls,
    downloads: h.r2Downloads, uploads: h.r2Uploads,
    humUpdates: h.humUpdates, history: h.historyCalls, library: h.libraryCalls,
  });

  it("fresh success charges exactly once, no replayed field, exactly one stored row", async () => {
    const a = await post("/hum-to-song", body);
    expect(a.status).toBe(200);
    expect(a.json?.["replayed"]).toBeUndefined();
    expect(a.json?.["humRef"]).toBe(HUM_ID);
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.key).toMatch(/^hum-to-song:user-1:/);
    expect(h.elMusicCalls).toBe(1); // one compose (conditioning upload is gated → text path)
    expect(h.r2Downloads).toBe(1); // the hum was loaded once
    expect(h.humUpdates).toBe(1); // songUrl stamped on the hum row once
    expect(h.stored.size).toBe(1);
    const row = [...h.stored.values()][0]!;
    expect(row.rail).toBe("hum-to-song");
    expect(row.result).toEqual(a.json);
  });

  it("identical re-ask is served from the stored row BEFORE the hum gate: hum row deleted, still 200 replayed:true, no re-consumption", async () => {
    const a = await post("/hum-to-song", body);
    expect(a.status).toBe(200);
    const before = workCalls();

    /* The hum is now consumed/gone: if the route resolved the hum
       before the stored pre-check, this re-ask would 404. The
       converted order serves the replay instead. */
    h.humRow = null;

    const b = await post("/hum-to-song", body);
    expect(b.status).toBe(200);
    expect(b.json?.["replayed"]).toBe(true);
    expect(b.json).toEqual({ ...a.json, replayed: true });
    expect(h.charges).toHaveLength(1);
    expect(workCalls()).toEqual(before); // no re-download, no provider call, no second hum update / history / library write
    expect(h.stored.size).toBe(1);
  });

  it("provider failure refunds + voids the key + stores nothing; retry charges fresh and succeeds", async () => {
    h.elMode = "throw";
    const failed = await post("/hum-to-song", body);
    expect(failed.status).toBe(500);
    expect(h.refunds).toHaveLength(1);
    expect(h.voids).toHaveLength(1);
    expect(h.voids[0]).toMatch(/^hum-to-song:user-1:/);
    expect(h.stored.size).toBe(0);

    h.elMode = "ok";
    const retry = await post("/hum-to-song", body);
    expect(retry.status).toBe(200);
    expect(retry.json?.["replayed"]).toBeUndefined();
    expect(h.charges).toHaveLength(2); // failed attempt + fresh retry charge
    expect(h.stored.size).toBe(1);
  });
});
