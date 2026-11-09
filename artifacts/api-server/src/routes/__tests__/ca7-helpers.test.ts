/**
 * CA-7 replay safety for the two helper-shaped files:
 *  - ai-page-designer.ts: the key is derived inside precheckAndCharge,
 *    so theme (400), bio (100) and banner (200) are all covered at
 *    once. A re-ask serves the stored body + `replayed: true` +
 *    replayNote — no second charge, no second provider call, and for
 *    the banner no second upload. Failures refund + void.
 *  - analytics.ts: the key is derived inside chargeOr402, covering
 *    insights (100) and suggestions (100) — with SEPARATE scopes, so
 *    an insights result can never answer a suggestions re-ask.
 *
 * Harness: the CA-KEY fake-credits ledger (key-aware charge
 * suppression + void tracking) fused with the key-aware stored-result
 * fake over @workspace/db (selection like lib/generation-stored-results).
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { createHash } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";

const USER = "user-1";

const h = vi.hoisted(() => ({
  balance: 10_000,
  charges: [] as Array<{ amount: number; key: string | null }>,
  refunds: [] as Array<{ amount: number }>,
  voids: [] as string[],
  chargedKeys: new Set<string>(),
  stored: new Map<string, { userId: string; rail: string; result: any }>(),
  chatCalls: 0,
  imageCalls: 0,
  uploads: 0,
  providerMode: "ok" as "ok" | "throw",
  chatPayload: "{}",
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

const FakeClasses = vi.hoisted(() => ({
  OutOfCreditsError: class FakeOutOfCredits extends Error {},
  LedgerWriteError: class FakeLedgerWrite extends Error {},
}));

const THEME_PAYLOAD = JSON.stringify({
  themeConfig: {
    themeId: "custom",
    colors: {
      background: "#0A0A0A", surface: "#141414", primary: "#C9A227", accent: "#FFD700",
      text: "#FFFFFF", mutedText: "#999999", cardBg: "#1A1A1A", border: "#333333",
    },
    fonts: { heading: "Cinzel", body: "Cinzel" },
    banner: { layout: "full-bleed", overlayOpacity: 0.5 },
    spacing: "comfortable",
    cornerRadius: "rounded",
  },
  sections: [
    { id: "s1", type: "hero", title: "Welcome", visible: true },
    { id: "s2", type: "tracks", title: "Music", visible: true },
  ],
  rationale: "Gold on black, built to convert.",
});
const BIO_PAYLOAD = JSON.stringify({ bio: "A creator with gold in their veins." });
const INSIGHTS_PAYLOAD = JSON.stringify({
  headline: "Momentum is building",
  movers: [{ platform: "instagram", observation: "Reels up", why: "Short hooks" }],
  bestWindow: "Weekday evenings",
  recommendations: ["Post the studio clip"],
});
const SUGGESTIONS_PAYLOAD = JSON.stringify({
  suggestions: [{ title: "Studio diaries", format: "reel", why: "Top post was BTS", hook: "Watch this" }],
});

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = USER;
    req.userCredits = h.balance;
    next();
  },
}));

vi.mock("../../lib/credits", () => ({
  OutOfCreditsError: FakeClasses.OutOfCreditsError,
  LedgerWriteError: FakeClasses.LedgerWriteError,
  buildChargeIdempotencyKey: (scope: string, userId: string, clientKey: unknown, intent: unknown) => {
    if (typeof clientKey === "string" && clientKey.trim().length >= 8) {
      return `${scope}:${userId}:client:${clientKey.trim()}`;
    }
    const hash = createHash("sha256").update(JSON.stringify(intent ?? null)).digest("hex").slice(0, 32);
    return `${scope}:${userId}:${hash}`;
  },
  chargeCredits: async (_userId: string, amount: number, _record: unknown, opts?: { idempotencyKey?: string }) => {
    const key = opts?.idempotencyKey ?? null;
    if (key !== null && h.chargedKeys.has(key)) return h.balance;
    if (h.balance < amount) throw new FakeClasses.OutOfCreditsError("out");
    h.balance -= amount;
    if (key !== null) h.chargedKeys.add(key);
    h.charges.push({ amount, key });
    return h.balance;
  },
  refundCredits: async (_userId: string, amount: number) => {
    h.balance += amount;
    h.refunds.push({ amount });
    return h.balance;
  },
  voidChargeIdempotencyKey: async (key: string) => {
    h.voids.push(key);
    h.chargedKeys.delete(key);
  },
}));

vi.mock("../../lib/ai-clients", () => ({
  getTextModel: () => "test-model",
  LOW_REASONING_PARAMS: { reasoning_effort: "low" },
  getOpenAI: () => ({
    chat: {
      completions: {
        create: async () => {
          h.chatCalls++;
          if (h.providerMode === "throw") throw new Error("provider exploded");
          return { choices: [{ message: { content: h.chatPayload } }] };
        },
      },
    },
    images: {
      generate: async () => {
        h.imageCalls++;
        if (h.providerMode === "throw") throw new Error("image provider exploded");
        return { data: [{ b64_json: "aW1hZ2U=" }] };
      },
    },
  }),
}));

vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../lib/supabase-admin", () => ({ getSupabaseAdmin: () => null }));
vi.mock("../../lib/r2-client", () => ({
  r2Upload: async (path: string) => {
    h.uploads++;
    return `https://cdn.example.com/${path}`;
  },
}));
vi.mock("../../lib/social-crypto", () => ({ decryptToken: vi.fn(), encryptToken: vi.fn() }));
vi.mock("../../lib/social-tiktok", () => ({
  refreshTikTokTokens: vi.fn(),
  TikTokApiError: class TikTokApiError extends Error {},
}));
vi.mock("../../lib/payment-record", () => ({ recordCreditUsageStrict: vi.fn(async () => undefined) }));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const { generationStoredResultsTable } = actual;
  const fakeDb = {
    select: () => ({
      from: (table: any) => {
        if (table === generationStoredResultsTable) {
          return {
            where: (cond: unknown) => ({
              limit: async () => {
                const key = keyFromCondition(cond);
                const row = key !== null ? h.stored.get(key) : undefined;
                return row ? [row] : [];
              },
            }),
          };
        }
        const chain: any = {
          where: () => chain,
          orderBy: () => chain,
          limit: async () => [],
          then: (res: any, rej: any) => Promise.resolve([]).then(res, rej),
        };
        return chain;
      },
    }),
    insert: (table: any) => ({
      values: (v: any) => {
        if (table === generationStoredResultsTable) {
          return {
            onConflictDoNothing: async () => {
              if (!h.stored.has(v.idempotencyKey)) {
                h.stored.set(v.idempotencyKey, { userId: v.userId, rail: v.rail, result: v.result });
              }
              return [];
            },
          };
        }
        return { returning: async () => [v] };
      },
    }),
    update: () => ({ set: () => ({ where: async () => [] }) }),
    delete: () => ({ where: async () => [] }),
  };
  return { ...actual, db: fakeDb };
});

import designerRouter, { __resetPageDesignerReplayCache } from "../ai-page-designer";
import analyticsRouter, { __resetAnalyticsReplayCache } from "../analytics";

let base = "";
let server: ReturnType<express.Express["listen"]>;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => { req.log = { error: () => {}, info: () => {} }; next(); });
  app.use("/api/ai-page-designer", designerRouter);
  app.use(analyticsRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise((r) => server.close(r)); });

beforeEach(() => {
  h.balance = 10_000;
  h.charges = [];
  h.refunds = [];
  h.voids = [];
  h.chargedKeys = new Set();
  h.stored = new Map();
  h.chatCalls = 0;
  h.imageCalls = 0;
  h.uploads = 0;
  h.providerMode = "ok";
  h.chatPayload = "{}";
  __resetPageDesignerReplayCache();
  __resetAnalyticsReplayCache();
});

async function postJson(path: string, body: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const themeBody = {
  vertical: "music",
  vibe: "dark luxury studio energy with gold everywhere",
  displayName: "King Shark",
  palette: ["#C9A227"],
};
const bioBody = {
  vertical: "music",
  displayName: "King Shark",
  facts: "Independent artist running a full creator studio.",
  length: "medium",
};
const bannerBody = {
  vertical: "music",
  vibe: "dark luxury studio energy",
  palette: ["#C9A227"],
};
const analyticsBody = {
  platforms: [{
    platform: "instagram",
    username: "king",
    stats: { followers: 1200, following: 10, mediaCount: 42, totalLikes: 9000 },
    topContent: [{ caption: "studio day", likes: 300, comments: 40 }],
  }],
  niche: "music",
};

describe("CA-7 ai-page-designer (helper-keyed)", () => {
  it("theme: fresh charges 400 once, provider once, persists; replay serves the stored design", async () => {
    h.chatPayload = THEME_PAYLOAD;
    const r1 = await postJson("/api/ai-page-designer/theme", themeBody);
    expect(r1.status).toBe(200);
    expect(r1.body.replayed).toBeUndefined();
    expect(r1.body.creditsUsed).toBe(400);
    expect(r1.body.sections[0].type).toBe("hero");
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(400);
    expect(h.chatCalls).toBe(1);
    expect(h.stored.size).toBe(1);
    const storedRow = [...h.stored.values()][0]!;
    expect(storedRow.rail).toBe("ai-page-designer-theme");
    expect(storedRow.result).toEqual(r1.body);

    const r2 = await postJson("/api/ai-page-designer/theme", themeBody);
    expect(r2.status).toBe(200);
    expect(r2.body).toEqual({ ...r1.body, replayed: true, replayNote: expect.any(String) });
    expect(h.charges).toHaveLength(1);
    expect(h.chatCalls).toBe(1);
  });

  it("theme: provider failure refunds + voids, stores nothing, retry charges fresh", async () => {
    h.providerMode = "throw";
    const r1 = await postJson("/api/ai-page-designer/theme", themeBody);
    expect(r1.status).toBe(502);
    expect(r1.body.refunded).toBe(true);
    expect(h.refunds).toHaveLength(1);
    expect(h.voids).toHaveLength(1);
    expect(h.stored.size).toBe(0);

    h.providerMode = "ok";
    h.chatPayload = THEME_PAYLOAD;
    const r2 = await postJson("/api/ai-page-designer/theme", themeBody);
    expect(r2.status).toBe(200);
    expect(r2.body.replayed).toBeUndefined();
    expect(h.charges).toHaveLength(2);
  });

  it("bio: fresh charges 100 once; replay serves the stored bio", async () => {
    h.chatPayload = BIO_PAYLOAD;
    const r1 = await postJson("/api/ai-page-designer/bio", bioBody);
    expect(r1.status).toBe(200);
    expect(r1.body.bio).toContain("gold");
    expect(r1.body.creditsUsed).toBe(100);
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(100);
    const storedRow = [...h.stored.values()][0]!;
    expect(storedRow.rail).toBe("ai-page-designer-bio");

    const r2 = await postJson("/api/ai-page-designer/bio", bioBody);
    expect(r2.body).toEqual({ ...r1.body, replayed: true, replayNote: expect.any(String) });
    expect(h.charges).toHaveLength(1);
    expect(h.chatCalls).toBe(1);
  });

  it("banner: fresh charges 200, generates + uploads once; replay serves the same banner (no second upload)", async () => {
    const r1 = await postJson("/api/ai-page-designer/banner", bannerBody);
    expect(r1.status).toBe(200);
    expect(r1.body.creditsUsed).toBe(200);
    expect(r1.body.url).toContain("profile-banner");
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(200);
    expect(h.imageCalls).toBe(1);
    expect(h.uploads).toBe(1);
    const storedRow = [...h.stored.values()][0]!;
    expect(storedRow.rail).toBe("ai-page-designer-banner");

    const r2 = await postJson("/api/ai-page-designer/banner", bannerBody);
    expect(r2.body).toEqual({ ...r1.body, replayed: true, replayNote: expect.any(String) });
    expect(h.charges).toHaveLength(1);
    expect(h.imageCalls).toBe(1);
    expect(h.uploads).toBe(1); // the stored banner is served — no re-upload
  });

  it("banner: provider failure refunds + voids and stores nothing", async () => {
    h.providerMode = "throw";
    const r1 = await postJson("/api/ai-page-designer/banner", bannerBody);
    expect(r1.status).toBe(502);
    expect(r1.body.refunded).toBe(true);
    expect(h.refunds).toHaveLength(1);
    expect(h.voids).toHaveLength(1);
    expect(h.stored.size).toBe(0);
  });
});

describe("CA-7 analytics (helper-keyed, per-rail scopes)", () => {
  it("insights: fresh charges 100 once, provider once, persists; replay serves the stored answer", async () => {
    h.chatPayload = INSIGHTS_PAYLOAD;
    const r1 = await postJson("/analytics/insights", analyticsBody);
    expect(r1.status).toBe(200);
    expect(r1.body.replayed).toBeUndefined();
    expect(r1.body.insights.headline).toBe("Momentum is building");
    expect(r1.body.creditsUsed).toBe(100);
    expect(h.charges).toHaveLength(1);
    expect(h.chatCalls).toBe(1);
    const storedRow = [...h.stored.values()][0]!;
    expect(storedRow.rail).toBe("analytics-insights");
    expect(storedRow.result).toEqual(r1.body);

    const r2 = await postJson("/analytics/insights", analyticsBody);
    expect(r2.body).toEqual({ ...r1.body, replayed: true, replayNote: expect.any(String) });
    expect(h.charges).toHaveLength(1);
    expect(h.chatCalls).toBe(1);
  });

  it("suggestions: separate scope — an insights result never answers a suggestions re-ask", async () => {
    h.chatPayload = INSIGHTS_PAYLOAD;
    await postJson("/analytics/insights", analyticsBody);
    expect(h.charges).toHaveLength(1);

    h.chatPayload = SUGGESTIONS_PAYLOAD;
    const r1 = await postJson("/analytics/suggestions", analyticsBody);
    expect(r1.status).toBe(200);
    expect(r1.body.replayed).toBeUndefined();
    expect(r1.body.suggestions).toHaveLength(1);
    expect(h.charges).toHaveLength(2); // charged fresh under its own scope
    const rails = [...h.stored.values()].map((r) => r.rail).sort();
    expect(rails).toEqual(["analytics-insights", "analytics-suggestions"]);

    const r2 = await postJson("/analytics/suggestions", analyticsBody);
    expect(r2.body).toEqual({ ...r1.body, replayed: true, replayNote: expect.any(String) });
    expect(h.charges).toHaveLength(2);
  });

  it("insights: provider failure refunds + voids, stores nothing, retry charges fresh", async () => {
    h.providerMode = "throw";
    const r1 = await postJson("/analytics/insights", analyticsBody);
    expect(r1.status).toBe(500);
    expect(r1.body.error).toBe("insights_failed");
    expect(h.refunds).toHaveLength(1);
    expect(h.voids).toHaveLength(1);
    expect(h.stored.size).toBe(0);

    h.providerMode = "ok";
    h.chatPayload = INSIGHTS_PAYLOAD;
    const r2 = await postJson("/analytics/insights", analyticsBody);
    expect(r2.status).toBe(200);
    expect(r2.body.replayed).toBeUndefined();
    expect(h.charges).toHaveLength(2);
  });
});
