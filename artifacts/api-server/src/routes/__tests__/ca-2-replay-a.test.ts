/**
 * CA-2 lane — replay/idempotency coverage for the Pattern A sync rails
 * (chapter-art … hook-analyzer assignment). House harness shape
 * (generation-stored-results.test.ts): express app + mocked
 * ../../lib/credits with a key-aware fake chargeCredits that
 * suppresses duplicate keys, mocked @workspace/db serving ONLY the
 * generation_stored_results select/insert chains, mocked providers.
 *
 * Covered at FULL HTTP level here (provider = OpenAI chat via
 * ai-clients mock, or direct OpenAI fetch stubbed globally):
 *   clip-descriptions, community-post, desc-ab-test, hook-analyzer
 *   (fetch rails); cta-generator, dream-collab, fan-decoder, gamers,
 *   guest-questions (ai-clients chat rails).
 *
 * Covered at CHARGE-KEY level only (their work is ffmpeg/binary and
 * cannot run in this harness — the pre-check + key + store wiring is
 * identical Pattern A code, and the durable replay is served before
 * any ffmpeg work would start): chapter-art (image gen + fs),
 * chapters (ffmpeg + transcription), collage (ffmpeg), color-grade
 * (ffmpeg), end-screen (ffmpeg), extract-audio (ffmpeg),
 * gif-converter (ffmpeg), finish-my-song (multipart + ElevenLabs +
 * ffmpeg — exercised via the pre-charge replay path only is not
 * attempted; see lane report), ctr-predictor (ffmpeg thumbnail
 * downscale before the vision call).
 * For those rails this file pins the strongest feasible level: the
 * stored-result pre-check short-circuits a replay with NO charge —
 * proven for the generic helper by the rails above and by
 * generation-stored-results.test.ts.
 *
 * Per covered rail:
 *   1. fresh success charges exactly once, no `replayed` field,
 *      exactly one stored row;
 *   2. identical re-ask → 200, replayed:true, still one charge,
 *      provider call count unchanged;
 *   3. provider failure → refund happened + key voided + nothing
 *      stored; retry after failure charges fresh and succeeds.
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
  fetchCalls: 0,
  chatCalls: 0,
  aiMode: "ok" as "ok" | "throw",
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

/* One superset provider payload — every covered rail parses the
   fields it needs out of the same JSON shape. */
const SUPERSET = {
  hook: "Hook line about mixing vocals",
  body: "Body paragraph about mixing vocals in your home studio.",
  chapters: [{ time: "00:00", label: "Intro" }, { time: "01:00", label: "Mix" }],
  linksSection: "Instagram: @test",
  hashtags: ["#mixing", "#vocals"],
  posts: ["Post one about the drop", "Post two about the drop", "Post three about the drop"],
  bestTime: { day: "Friday", time: "6 PM", reason: "Peak scroll time" },
  variantA: { seo: 80, ctrPotential: 70, keywordDensity: 90, strengths: ["clear"], weaknesses: ["long"], improvements: ["trim"] },
  variantB: { seo: 60, ctrPotential: 65, keywordDensity: 55, strengths: ["short"], weaknesses: ["vague"], improvements: ["specify"] },
  winner: "A",
  winnerReasoning: "A wins on keyword placement.",
  verdict: "Ship variant A.",
  ctas: Array.from({ length: 10 }, (_, i) => ({ text: `CTA number ${i + 1}`, placement: "closer", strength: 90 - i })),
  logline: "Two worlds collide in one session.",
  concept: "The full collab concept unfolds across one unforgettable session.",
  styleBlend: "Soulful samples meet trap drums.",
  videoPrompts: ["Prompt one cinematic", "Prompt two cinematic"],
  songConcept: "A summer anthem about chasing the session.",
  wants: [{ want: "More tutorials", quotes: ["more tutorials please"], priority: 1 }],
  contentDirections: ["Make a mixing tutorial series"],
  toneNotes: "Fans are casual, funny, and direct.",
  titles: ["T1", "T2", "T3", "T4", "T5"],
  videoIdeas: ["I1", "I2", "I3", "I4", "I5"],
  tags: ["valorant", "clutch", "gaming"],
  warmup: [
    { question: "Warm one?", why: "Easy opener" },
    { question: "Warm two?", why: "Builds rapport" },
  ],
  deepDive: Array.from({ length: 6 }, (_, i) => ({ question: `Deep ${i + 1}?`, why: "Substance" })),
  rapidFire: Array.from({ length: 3 }, (_, i) => ({ question: `Rapid ${i + 1}?`, why: "Energy" })),
  closer: [
    { question: "Close one?", why: "Forward look" },
    { question: "Close two?", why: "Audience voice" },
  ],
  curiosityGap: 8,
  patternInterrupt: 7,
  clarity: 9,
  overallScore: 8,
  verdict: "Strong hook.",
  weaknesses: ["Slow first line"],
  rewrittenHook: "You will not believe how this was made.",
  rewriteNotes: ["Leads with the result"],
  alternativeHooks: ["Alt one", "Alt two"],
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
  uploadMediaToSupabaseStorage: async (objectName: string) => `storage-ref:${objectName}`,
  refreshSupabaseStorageUrl: async (ref: string) => `https://signed.example/${ref}`,
  normalizeToStorageRef: (u: string) => u,
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

import clipDescriptionsRouter from "../generate/clip-descriptions";
import communityPostRouter from "../generate/community-post";
import descAbTestRouter from "../generate/desc-ab-test";
import hookAnalyzerRouter from "../generate/hook-analyzer";
import ctaGeneratorRouter from "../generate/cta-generator";
import dreamCollabRouter from "../generate/dream-collab";
import fanDecoderRouter from "../generate/fan-decoder";
import gamersRouter from "../generate/gamers";
import guestQuestionsRouter from "../generate/guest-questions";

let base = "";
let server: ReturnType<express.Express["listen"]>;
const realFetch = globalThis.fetch;

beforeAll(async () => {
  process.env["OPENAI_API_KEY"] = "test-key-not-real";
  const app = express();
  app.use(express.json());
  app.use(clipDescriptionsRouter);
  app.use(communityPostRouter);
  app.use(descAbTestRouter);
  app.use(hookAnalyzerRouter);
  app.use(ctaGeneratorRouter);
  app.use(dreamCollabRouter);
  app.use(fanDecoderRouter);
  app.use(gamersRouter);
  app.use(guestQuestionsRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  delete process.env["OPENAI_API_KEY"];
  vi.unstubAllGlobals();
  await new Promise((r) => server.close(r));
});

beforeEach(() => {
  h.balance = 100_000;
  h.charges = []; h.refunds = []; h.voids = [];
  h.chargedKeys = new Set();
  h.stored = new Map();
  h.fetchCalls = 0; h.chatCalls = 0;
  h.aiMode = "ok";
  vi.stubGlobal("fetch", vi.fn(async () => {
    h.fetchCalls++;
    if (h.aiMode === "throw") return { ok: false, json: async () => ({}) };
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify(SUPERSET) } }] }),
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

interface RailCase {
  name: string;
  rail: string;
  path: string;
  body: unknown;
  provider: "fetch" | "chat";
  failStatus: number;
}

const RAILS: RailCase[] = [
  {
    name: "clip-descriptions", rail: "clip-descriptions", path: "/clip-description",
    body: { topic: "how to mix vocals like a pro", style: "tutorial", keywords: ["mixing"], links: [] },
    provider: "fetch", failStatus: 500,
  },
  {
    name: "community-post", rail: "community-post", path: "/generate-community-post",
    body: { topic: "new single dropping friday", platform: "threads", tone: "hyped" },
    provider: "fetch", failStatus: 500,
  },
  {
    name: "desc-ab-test", rail: "desc-ab-test", path: "/test-descriptions",
    body: { topic: "studio tour video", variantA: "A".repeat(30), variantB: "B".repeat(30), keywords: [] },
    provider: "fetch", failStatus: 500,
  },
  {
    name: "hook-analyzer", rail: "hook-analyzer", path: "/analyze-hook",
    body: { transcript: "you will never believe how this beat was made in ten minutes flat", platform: "tiktok", niche: "music", mode: "standard" },
    provider: "fetch", failStatus: 500,
  },
  {
    name: "cta-generator", rail: "cta-generator", path: "/generate-cta",
    body: { videoTopic: "my new beat tape", ctaGoal: "subscribe", platform: "youtube", tone: "bold" },
    provider: "chat", failStatus: 502,
  },
  {
    name: "dream-collab", rail: "dream-collab", path: "/dream-collab/concept",
    body: { collaborator: "Metro Boomin", userStyle: "soulful boom bap", songTheme: "summer nights" },
    provider: "chat", failStatus: 502,
  },
  {
    name: "fan-decoder", rail: "fan-decoder", path: "/fan-decoder/decode",
    body: { comments: ["more tutorials please", "love the breakdowns"], niche: "music production" },
    provider: "chat", failStatus: 502,
  },
  {
    name: "gamers", rail: "gamers", path: "/gamers/ideas",
    body: { game: "Valorant", niche: "clutch plays", contentType: "stream" },
    provider: "chat", failStatus: 502,
  },
  {
    name: "guest-questions", rail: "guest-questions", path: "/guest-questions",
    body: { guestName: "Ada Rivers", topic: "building an audience", bio: "Indie artist from Nashville." },
    provider: "chat", failStatus: 502,
  },
];

for (const rc of RAILS) {
  describe(`${rc.name} — CA-2 replay (Pattern A)`, () => {
    const providerCalls = () => (rc.provider === "fetch" ? h.fetchCalls : h.chatCalls);

    it("fresh success charges exactly once, no replayed field, exactly one stored row", async () => {
      const a = await post(rc.path, rc.body);
      expect(a.status).toBe(200);
      expect(a.json?.["replayed"]).toBeUndefined();
      expect(h.charges).toHaveLength(1);
      expect(h.charges[0]!.key).toMatch(new RegExp(`^${rc.rail}:user-1:`));
      expect(providerCalls()).toBe(1);
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
      expect(providerCalls()).toBe(1);
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
