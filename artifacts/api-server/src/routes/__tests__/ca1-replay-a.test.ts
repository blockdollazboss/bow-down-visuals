/**
 * CA-1 (Stack 400 charge audit, batch B1) — EXPOSED-REPLAY closure for
 * the LLM/text rails: academy (×3), ai-coach, ai-copilot, ai-interview
 * (×2), analytics-hub, best-time, brand-calculator, brand-deals (×2),
 * broll-suggester.
 *
 * Harness: the REAL lib/credits + lib/payment-record +
 * lib/generation-stored-results modules over an in-memory Postgres
 * (pg-mem via lib/__tests__/test-db — the credits-void / ca-races-pg
 * shape), an in-memory supabase profile for balances, and fake
 * lib/ai-clients whose chat completion returns a per-rail canned body
 * (keyed off the system prompt) or throws in fail mode. Trackers are
 * re-derived from the real ledger rows by syncTrackers().
 *
 * Per rail the suite pins:
 *   - fresh POST → 200, exactly one charge, one provider call, one
 *     stored row, and NO replay marker on the fresh body;
 *   - identical POST again → the stored body verbatim + replayed:true,
 *     still one charge and one provider call;
 *   - provider failure on a fresh intent → the rail's error status, a
 *     refund AND a void of that request's key, no stored row;
 *   - the same intent retried with the provider healthy → 200 with a
 *     SECOND charge (the voided key never replay-suppresses a paid
 *     retry into a free run).
 * Plus one concurrency pin: two identical simultaneous POSTs produce
 * exactly one charge and one provider run.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
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
  /* REAL-credits harness state: the pg-mem db handle + the supabase
     profile row (balances live in the profile; the ledger lives in
     pg-mem credit_usage). */
  db: null as any,
  profile: null as null | { id: string; credits: number; bonus_credits: number; bonus_credits_expires_at: string | null },
  seenKeys: new Map<string, string>(),
  mem: null as any,
}));

/* The rails always look up BY KEY — recover the key from the eq()
   the storage lib built (same walker as generation-stored-results). */
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
            return Promise.resolve({ data: null, error: null }).then(res, rej);
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

/* payment-record (real, pulled in by credits.ts) imports push-events,
   which imports the web-push stack — leaf-stub it. */
vi.mock("../../lib/push-events", () => ({
  notifyUserEvent: async () => {},
}));

vi.mock("../../lib/ai-clients", () => ({
  getTextModel: () => "test-model",
  LOW_REASONING_PARAMS: { reasoning_effort: "low" },
  /* Keyless fake client for ai-copilot's dynamic-import config gate:
     it does NOT throw when OPENAI_API_KEY is unset (unlike the real
     client), it just reports the key's absence so the gate passes in
     the harness the same way it passes with a configured server. */
  isOpenAIConfigured: () => true,
  getOpenAI: () => ({
    chat: {
      completions: {
        create: async () => {
          h.providerCalls++;
          if (h.providerMode === "throw") throw new Error("provider down");
          /* One superset body satisfying every rail's parse contract
             (each handler reads only its own fields). */
          const content = JSON.stringify({
            path: [{ courseId: "video-production", title: "Video Production", why: "Core skill", order: 1 }],
            weeklyPlan: "Week 1: foundations.",
            firstStep: "Watch lesson one today",
            answer: "Coach answer text.",
            sections: [{ heading: "Basics", body: "Text" }, { heading: "Depth", body: "More" }, { heading: "Practice", body: "Do" }],
            takeaways: ["One", "Two", "Three"],
            actionStep: "Do it today",
            insights: "Your hooks land in the first second.",
            patterns: ["p1"],
            mistakes: ["m1"],
            nextSteps: ["n1"],
            summary: "Growth summary.",
            recommendations: ["r1", "r2", "r3"],
            bestPlatform: "tiktok",
            focusArea: "hooks",
            questions: ["Q1?", "Q2?", "Q3?", "Q4?", "Q5?"],
            clips: [1, 2, 3, 4, 5].map((i) => ({ quote: `quote ${i}`, why: "w" })),
            quoteCards: ["c1", "c2", "c3"],
            promoOutline: ["p1", "p2", "p3", "p4", "p5"],
            deals: [{
              brand: "Acme", dealType: "Sponsored Post", fitScore: 90,
              fitReason: "fits the channel", valueRange: "$400-$600",
              outreachAngle: "lead with the review series", verifyNote: "verify the brand first",
            }],
            subject: "Collab?",
            message: "Hi Acme — let's work together on a sponsored post.",
            tips: ["t1", "t2", "t3"],
            rateRange: { low: 400, high: 650, currency: "USD" },
            perPost: 500,
            package3: 1400,
            breakdown: [{ deliverable: "Post", low: 400, high: 650 }],
            usageRights: [{ term: "30 days", surcharge: "10%" }],
            negotiationTips: ["tip"],
            suggestions: [{
              title: "Add a cut", reason: "pace", severity: "polish",
              action: { kind: "set-transition", sceneIndex: 0, transition: "Cut" }, atSec: 3,
            }],
            windows: [{ platform: "tiktok", weekday: 1, startHour: 18, endHour: 20, boost: 10, reason: "peak" }],
            scenes: [{ startSec: 0, endSec: 5, videoPrompt: "a wide shot" }],
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

vi.mock("../../lib/co-stars", () => ({
  /* auto-video-plan awaits this for the brief; an empty mock surface
     would throw on the missing export. */
  buildCoStarContext: async () => "",
}));

/* credits-void (real credits on pg-mem) parity: the pg-mem drizzle db
   has NO `teams` table, so the REAL lib/teams.getUserActiveTeam throws
   ECONNREFUSED-style before any ledger logic — the file's own teams
   mock sits too late in module-registration order to cover the
   credits module's import. This mock is registered AFTER the payment-
   record mock so it wins for every importer: teamless user, exactly
   as credits-ledger pins it. */
vi.mock("../../lib/teams", () => ({
  getUserActiveTeam: async () => null,
  deductTeamCredits: async () => { throw new Error("deductTeamCredits must not be called on the personal-balance path"); },
}));

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
`;

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

import academyRouter from "../generate/academy";
import aiCoachRouter from "../generate/ai-coach";
import aiCopilotRouter from "../generate/ai-copilot";
import aiInterviewRouter from "../generate/ai-interview";
import analyticsHubRouter from "../generate/analytics-hub";
import bestTimeRouter from "../generate/best-time";
import brandCalculatorRouter from "../generate/brand-calculator";
import brandDealsRouter from "../generate/brand-deals";
import brollRouter from "../generate/broll-suggester";
import autoVideoPlanRouter from "../generate/auto-video-plan";

const realFetch = globalThis.fetch;
let server: any;
let base = "";

beforeAll(async () => {
  process.env["OPENAI_API_KEY"] = "test-key-not-real";
  const app = express();
  app.use(express.json());
  app.use(academyRouter);
  app.use(aiCoachRouter);
  app.use(aiCopilotRouter);
  app.use(aiInterviewRouter);
  app.use(analyticsHubRouter);
  app.use(bestTimeRouter);
  app.use(brandCalculatorRouter);
  app.use(brandDealsRouter);
  app.use(brollRouter);
  app.use(autoVideoPlanRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  delete process.env["OPENAI_API_KEY"];
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
  h.balance = 100_000;
  h.charges = []; h.refunds = []; h.voids = [];
  h.chargedKeys = new Set();
  h.stored = new Map();
  h.providerCalls = 0; h.providerMode = "ok";
  h.fetchCalls = 0; h.fetchMode = "ok";
  vi.stubGlobal("fetch", vi.fn(async (url: unknown, init?: { body?: string }) => {
    h.fetchCalls++;
    if (h.fetchMode === "throw") return { ok: false, json: async () => ({}) };
    /* ai-copilot asks for editor suggestions: its fetch body embeds
       the prompt text ("Return 4-8 concrete, actionable suggestions").
       Broll's body carries only the script text. */
    const payload = String(init?.body ?? "");
    if (payload.includes("actionable suggestions")) {
      return {
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: JSON.stringify({
                suggestions: [{
                  title: "Add a cut", reason: "pace", severity: "polish",
                  action: { kind: "set-transition", sceneIndex: 0, transition: "Cut" }, atSec: 3,
                }],
              }),
            },
          }],
        }),
      };
    }
    return {
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              /* broll-suggester shape */
              suggestions: [{ narration: "Hello world this is a test script", brollPrompt: "A city skyline at dusk", keywords: ["city"] }],
            }),
          },
        }],
      }),
    };
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

interface RailCase {
  name: string;
  path: string;
  body: Record<string, unknown>;
  failBody: Record<string, unknown>;
  cost: number;
  rail: string;
  /* A number pins the failing status; "any-error" accepts any 4xx/5xx
     (auto-video-plan: a generic provider throw surfaces as 500, not
     the 502 the summary once assumed). */
  failStatus: number | "any-error";
}

const CASES: RailCase[] = [
  {
    name: "academy learning-path", path: "/academy/learning-path", cost: 100, rail: "academy-learning-path", failStatus: 502,
    body: { goals: "Grow my channel fast", niche: "gaming", level: "beginner", platforms: ["youtube"], hoursPerWeek: 5 },
    failBody: { goals: "Grow my channel fast", niche: "fitness", level: "beginner", platforms: ["youtube"], hoursPerWeek: 5 },
  },
  {
    name: "academy ask", path: "/academy/ask", cost: 100, rail: "academy-ask", failStatus: 502,
    body: { courseId: "video-production", question: "How do I light a small room?" },
    failBody: { courseId: "video-production", question: "How do I mic a small room?" },
  },
  {
    name: "academy lesson", path: "/academy/lesson", cost: 100, rail: "academy-lesson", failStatus: 502,
    body: { courseId: "video-production", lessonId: "framing" },
    failBody: { courseId: "video-production", lessonId: "lighting" },
  },
  {
    name: "ai-coach", path: "/ai-coach", cost: 100, rail: "ai-coach", failStatus: 502,
    body: { platform: "tiktok", posts: [{ title: "First post", views: 100, likes: 10 }], niche: "gaming" },
    failBody: { platform: "tiktok", posts: [{ title: "Second post", views: 200, likes: 20 }], niche: "gaming" },
  },
  {
    name: "ai-copilot analyze", path: "/analyze", cost: 50, rail: "ai-copilot", failStatus: 500,
    body: { scenes: [{ id: "s1", sceneNumber: 1 }], songTitle: "Song A" },
    failBody: { scenes: [{ id: "s2", sceneNumber: 1 }], songTitle: "Song B" },
  },
  {
    name: "ai-interview questions", path: "/ai-interview/questions", cost: 100, rail: "ai-interview-questions", failStatus: 502,
    body: { topic: "My new album", niche: "music" },
    failBody: { topic: "My tour life", niche: "music" },
  },
  {
    name: "ai-interview package", path: "/ai-interview/package", cost: 200, rail: "ai-interview-package", failStatus: 502,
    body: {
      topic: "My new album",
      qa: [1, 2, 3, 4, 5].map((i) => ({ question: `Q${i}?`, answer: `A${i}.` })),
    },
    failBody: {
      topic: "My tour life",
      qa: [1, 2, 3, 4, 5].map((i) => ({ question: `Q${i}?`, answer: `A${i}.` })),
    },
  },
  {
    name: "analytics-hub", path: "/analytics-hub/insights", cost: 200, rail: "analytics-hub", failStatus: 502,
    body: { platforms: [{ platform: "tiktok", followers: 1000, views7d: 5000, views30d: 20000, engagementRate: 5, topPostViews: 900 }] },
    failBody: { platforms: [{ platform: "tiktok", followers: 2000, views7d: 5000, views30d: 20000, engagementRate: 5, topPostViews: 900 }] },
  },
  {
    /* best-time's only provider call is the niche-tuning pass, which
       fails SOFT (benchmark slots still returned, charge stands) by
       design — so it has no refund path to pin; failStatus 200 marks
       the soft-failure shape and the failure test asserts the charge
       stands with nothing refunded, voided, or stored-stale. */
    name: "best-time", path: "/best-time", cost: 75, rail: "best-time", failStatus: 200,
    body: { platforms: ["tiktok"], niche: "gaming" },
    failBody: { platforms: ["tiktok"], niche: "fitness" },
  },
  {
    name: "brand-calculator", path: "/brand-calculator/calculate", cost: 200, rail: "brand-calculator", failStatus: 502,
    body: { platform: "youtube", followers: 50000, avgViews: 20000, engagementRate: 4.5, contentType: "sponsored_post", niche: "gaming" },
    failBody: { platform: "youtube", followers: 60000, avgViews: 20000, engagementRate: 4.5, contentType: "sponsored_post", niche: "gaming" },
  },
  {
    name: "brand-deals finder", path: "/brand-deals", cost: 200, rail: "brand-deals-finder", failStatus: 502,
    body: { niche: "gaming", audienceSize: "10k-50k", platforms: ["youtube"], contentStyle: "reviews" },
    failBody: { niche: "fitness", audienceSize: "10k-50k", platforms: ["youtube"], contentStyle: "reviews" },
  },
  {
    name: "brand-deals outreach", path: "/brand-deals/outreach", cost: 100, rail: "brand-deals-outreach", failStatus: 502,
    body: { brand: "Acme", creatorName: "Thy", niche: "gaming", audienceSize: "10k-50k", platforms: ["youtube"] },
    failBody: { brand: "Globex", creatorName: "Thy", niche: "gaming", audienceSize: "10k-50k", platforms: ["youtube"] },
  },
  {
    name: "broll-suggester", path: "/broll-suggest", cost: 75, rail: "broll-suggester", failStatus: 500,
    body: { script: "This is a narration script long enough to pass validation checks." },
    failBody: { script: "Another narration script that is also long enough to validate." },
  },
  {
    /* auto-video-plan: durationSec is the one required field (positive
       number, coerced). Fail = provider throw → the catch refunds and
       voids, then answers 500. */
    name: "auto-video-plan", path: "/auto-video-plan", cost: 200, rail: "auto-video-plan", failStatus: "any-error",
    body: { songTitle: "First Song", durationSec: 120 },
    failBody: { songTitle: "Second Song", durationSec: 120 },
  },
];

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
      const callsAfterFresh = h.providerCalls + h.fetchCalls;
      expect(callsAfterFresh).toBeGreaterThan(0);
      expect(h.stored.size).toBe(1);

      const b = await post(c.path, c.body);
      expect(b.status).toBe(200);
      expect(b.json?.replayed).toBe(true);
      expect(typeof b.json?.replayNote).toBe("string");
      const { replayed: _r1, replayNote: _n1, ...bRest } = b.json!;
      const { ...aRest } = a.json!;
      expect(bRest).toEqual(aRest);
      await syncTrackers();
      expect(h.charges).toHaveLength(1);
      expect(h.providerCalls + h.fetchCalls).toBe(callsAfterFresh);
      expect(h.stored.size).toBe(1);
    });

    it("provider failure refunds AND voids; the retry charges fresh", async () => {
      h.providerMode = "throw";
      h.fetchMode = "throw";
      const f = await post(c.path, c.failBody);
      if (c.failStatus === 200) {
        /* best-time soft-failure shape: the tuning call failing does
           NOT fail the request — the charge stands, benchmark slots
           are served, nothing is refunded or voided. */
        expect(f.status).toBe(200);
        await syncTrackers();
        expect(h.charges).toHaveLength(1);
        expect(h.refunds).toEqual([]);
        expect(h.voids).toEqual([]);
        return;
      }
      if (c.failStatus === "any-error") {
        expect(f.status).toBeGreaterThanOrEqual(400);
      } else {
        expect(f.status).toBe(c.failStatus);
      }
      await syncTrackers();
      expect(h.charges).toHaveLength(1);
      expect(h.refunds).toEqual([c.cost]);
      expect(h.voids).toEqual([h.charges[0]!.key]);
      expect(h.stored.size).toBe(0);

      h.providerMode = "ok";
      h.fetchMode = "ok";
      const retry = await post(c.path, c.failBody);
      expect(retry.status).toBe(200);
      expect(retry.json?.replayed).toBeUndefined();
      await syncTrackers();
      expect(h.charges).toHaveLength(2);
      expect(h.stored.size).toBe(1);
    });
  });
}

describe("CA-1 replay — concurrency", () => {
  it("two identical simultaneous academy asks produce exactly one charge and one provider run", async () => {
    const body = { courseId: "video-production", question: "How do I light a small room?" };
    const [a, b] = await Promise.all([post("/academy/ask", body), post("/academy/ask", body)]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    await syncTrackers();
    expect(h.charges).toHaveLength(1);
    expect(h.providerCalls).toBe(1);
  });
});
