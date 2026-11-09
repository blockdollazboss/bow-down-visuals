/**
 * CA-7 replay safety — batch A (canonical wraps):
 *  - discord.ts POST /discord/ai-announcement (100)
 *  - retention-doctor.ts POST /retention-doctor (150)
 *  - live-shopping.ts POST /live-shopping/ai-description (100)
 *  - player-upgrades.ts POST /showcase-items/:itemId/auto-chapters/generate (150)
 *
 * Per rail: fresh charges once + provider once + stored row = body;
 * re-ask serves stored + `replayed: true` (+ replayNote where the rail
 * carries one) with counts frozen; provider failure refunds + voids
 * the charge key, stores nothing, and the retry charges fresh.
 *
 * Harness: the CA-KEY fake-credits ledger + key-aware stored-result
 * fake over @workspace/db, with per-table row stores for the rails
 * that read/write their own tables (discord streams, showcase items,
 * auto-chapters rows).
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { createHash, randomUUID } from "crypto";
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
  stores: new Map<any, Array<Record<string, any>>>(),
  chatCalls: 0,
  chatMode: "ok" as "ok" | "throw",
  chatPayload: "{}",
  transcribeCalls: 0,
  transcribeMode: "ok" as "ok" | "throw",
}));

function tableStore(table: any): Array<Record<string, any>> {
  let s = h.stores.get(table);
  if (!s) { s = []; h.stores.set(table, s); }
  return s;
}

function collectEq(node: any, out: Record<string, unknown>): void {
  if (!node || typeof node !== "object") return;
  const chunks: any[] = Array.isArray(node.queryChunks) ? node.queryChunks : [];
  let pendingCol: string | null = null;
  for (const ch of chunks) {
    if (ch && typeof ch === "object") {
      if (typeof ch.name === "string" && ch.table) { pendingCol = ch.name; continue; }
      if (ch.constructor?.name === "Param" && pendingCol) { out[pendingCol] = ch.value; pendingCol = null; continue; }
      if (Array.isArray(ch.queryChunks)) collectEq(ch, out);
      if (Array.isArray(ch.value)) for (const v of ch.value) collectEq(v, out);
    }
  }
}
function matches(row: Record<string, any>, cond: any): boolean {
  const eqs: Record<string, unknown> = {};
  collectEq(cond, eqs);
  return Object.entries(eqs).every(([k, v]) => String(row[k]) === String(v));
}

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
          if (h.chatMode === "throw") throw new Error("provider exploded");
          return { choices: [{ message: { content: h.chatPayload } }] };
        },
      },
    },
  }),
}));

vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../lib/social-crypto", () => ({
  encryptToken: (v: string) => v,
  decryptToken: (v: string) => v,
  isSocialTokenKeyConfigured: () => true,
}));
vi.mock("../../lib/stripe-checkout", () => ({}));
vi.mock("../../lib/embedded-checkout", () => ({ isEmbeddedCheckoutEnabled: () => false }));
vi.mock("../../lib/mirrorMedia", () => ({
  mirrorExternalMediaUrl: vi.fn(async (v: string | null | undefined) => v ?? null),
}));
vi.mock("../../lib/objectStorage", () => ({
  refreshSupabaseStorageUrl: vi.fn(async (v: string) => v),
  refreshSupabaseStorageUrlsDeep: vi.fn(async (x: any) => x),
}));
vi.mock("../../lib/thumbnail-duels", () => ({
  pickDuelCover: () => null,
  duelOutcome: () => null,
  duelResultsView: (x: any) => x,
  clampDuelTargetViews: (n: number) => n,
}));
vi.mock("../../lib/karaoke-lyrics", () => ({
  parseLrc: () => [],
  validateTimedLyrics: () => ({ ok: true }),
}));

vi.mock("../generate/auto-chapters", () => ({
  transcribeAudioUrl: async () => {
    h.transcribeCalls++;
    if (h.transcribeMode === "throw") throw new Error("transcription exploded");
    return [{ text: "welcome back to the studio", start: 0 }, { text: "today we cook", start: 30 }];
  },
  detectTimedChapters: async () => [{ title: "Intro", startSec: 0, endSec: 30 }],
  sanitizeTimedChapters: (cs: any) => cs,
  generateSummaryFromTranscript: async () => "A studio session.",
}));

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
        let cond: any = null; let lim: number | null = null;
        const run = () => {
          let rows = cond ? tableStore(table).filter((r) => matches(r, cond)) : [...tableStore(table)];
          if (lim !== null) rows = rows.slice(0, lim);
          return rows;
        };
        const chain: any = {
          where: (c: any) => { cond = c; return chain; },
          orderBy: (..._a: any[]) => chain,
          limit: async (n: number) => { lim = n; return run(); },
          then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
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
        const build = () => {
          const row = { ...v, id: v.id ?? randomUUID(), created_at: new Date(), updated_at: new Date() };
          tableStore(table).push(row);
          return [row];
        };
        return {
          returning: async () => build(),
          onConflictDoUpdate: () => ({ returning: async () => build() }),
          onConflictDoNothing: async () => build(),
        };
      },
    }),
    update: (table: any) => ({
      set: (patch: Record<string, any>) => ({
        where: (cond: any) => ({
          returning: async () => {
            const hit = tableStore(table).filter((r) => matches(r, cond));
            for (const r of hit) Object.assign(r, patch);
            return hit;
          },
          then: (res: any, rej: any) => {
            const hit = tableStore(table).filter((r) => matches(r, cond));
            for (const r of hit) Object.assign(r, patch);
            return Promise.resolve(hit).then(res, rej);
          },
        }),
      }),
    }),
    delete: (table: any) => ({
      where: async (cond: any) => {
        h.stores.set(table, tableStore(table).filter((r) => !matches(r, cond)));
      },
    }),
  };
  return { ...actual, db: fakeDb };
});

import discordRouter, { __resetDiscordAnnouncementReplayCache } from "../discord";
import retentionRouter, { __resetRetentionDoctorReplayCache } from "../retention-doctor";
import liveShoppingRouter, { __resetLiveShoppingDescriptionReplayCache } from "../live-shopping";
import playerUpgradesRouter, { __resetAutoChaptersReplayCache } from "../player-upgrades";
import { showcaseItemsTable } from "@workspace/db";

let base = "";
let server: ReturnType<express.Express["listen"]>;

const ITEM_ID = randomUUID();

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => { req.log = { error: () => {}, info: () => {} }; next(); });
  app.use(discordRouter);
  app.use(retentionRouter);
  app.use(liveShoppingRouter);
  app.use(playerUpgradesRouter);
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
  h.stores = new Map();
  h.chatCalls = 0;
  h.chatMode = "ok";
  h.chatPayload = "{}";
  h.transcribeCalls = 0;
  h.transcribeMode = "ok";
  tableStore(showcaseItemsTable).push({
    id: ITEM_ID, user_id: USER, media_type: "video",
    media_url: "https://cdn.example.com/video.mp4", title: "Studio Session",
  });
  __resetDiscordAnnouncementReplayCache();
  __resetRetentionDoctorReplayCache();
  __resetLiveShoppingDescriptionReplayCache();
  __resetAutoChaptersReplayCache();
});

async function postJson(path: string, body: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

describe("CA-7 discord ai-announcement", () => {
  const body = { type: "live", topic: "new single drop party", game: "Studio Sessions", tone: "hype" };

  it("fresh charges 100 once, provider once, persists; replay serves the stored announcement", async () => {
    h.chatPayload = JSON.stringify({ title: "WE LIVE", message: "Tap in right now — new single premiere." });
    const r1 = await postJson("/discord/ai-announcement", body);
    expect(r1.status).toBe(200);
    expect(r1.body.replayed).toBeUndefined();
    expect(r1.body.title).toBe("WE LIVE");
    expect(r1.body.creditsUsed).toBe(100);
    expect(h.charges).toHaveLength(1);
    expect(h.chatCalls).toBe(1);
    const storedRow = [...h.stored.values()][0]!;
    expect(storedRow.rail).toBe("discord-ai-announcement");
    expect(storedRow.result).toEqual(r1.body);

    const r2 = await postJson("/discord/ai-announcement", body);
    expect(r2.body).toEqual({ ...r1.body, replayed: true, replayNote: expect.any(String) });
    expect(h.charges).toHaveLength(1);
    expect(h.chatCalls).toBe(1);
  });

  it("provider failure refunds + voids, stores nothing, retry charges fresh", async () => {
    h.chatMode = "throw";
    const r1 = await postJson("/discord/ai-announcement", body);
    expect(r1.status).toBe(502);
    expect(r1.body.error).toContain("hiccupped");
    expect(h.refunds).toHaveLength(1);
    expect(h.voids).toHaveLength(1);
    expect(h.stored.size).toBe(0);

    h.chatMode = "ok";
    h.chatPayload = JSON.stringify({ title: "T", message: "M" });
    const r2 = await postJson("/discord/ai-announcement", body);
    expect(r2.status).toBe(200);
    expect(r2.body.replayed).toBeUndefined();
    expect(h.charges).toHaveLength(2);
  });
});

describe("CA-7 retention-doctor", () => {
  const body = {
    title: "My Studio Vlog",
    dropOffs: [{ at: "0:12", dropPct: 40 }],
    totalLength: "8:00",
    niche: "music",
  };
  const payload = JSON.stringify({
    reportCard: { grade: "B", score: 72, headline: "Strong middle, leaky open" },
    summary: "Viewers leave at the intro, then stay.",
    diagnoses: [{
      at: "0:12", dropPct: 40, causeCategory: "weak-hook", causeLabel: "Weak hook",
      diagnosis: "The cold open buries the payoff.", prescription: "Open on the finished hook.",
      fixAction: "hook",
    }],
  });

  it("fresh charges 150 once, provider once, persists; replay serves the stored diagnosis", async () => {
    h.chatPayload = payload;
    const r1 = await postJson("/retention-doctor", body);
    expect(r1.status).toBe(200);
    expect(r1.body.replayed).toBeUndefined();
    expect(r1.body.creditsUsed).toBe(150);
    expect(r1.body.reportCard.grade).toBe("B");
    expect(h.charges).toHaveLength(1);
    expect(h.chatCalls).toBe(1);
    const storedRow = [...h.stored.values()][0]!;
    expect(storedRow.rail).toBe("retention-doctor");
    expect(storedRow.result).toEqual(r1.body);

    const r2 = await postJson("/retention-doctor", body);
    expect(r2.body).toEqual({ ...r1.body, replayed: true, replayNote: expect.any(String) });
    expect(h.charges).toHaveLength(1);
    expect(h.chatCalls).toBe(1);
  });

  it("provider failure refunds + voids, stores nothing, retry charges fresh", async () => {
    h.chatMode = "throw";
    const r1 = await postJson("/retention-doctor", body);
    expect(r1.status).toBe(502);
    expect(h.refunds).toHaveLength(1);
    expect(h.voids).toHaveLength(1);
    expect(h.stored.size).toBe(0);

    h.chatMode = "ok";
    h.chatPayload = payload;
    const r2 = await postJson("/retention-doctor", body);
    expect(r2.status).toBe(200);
    expect(r2.body.replayed).toBeUndefined();
    expect(h.charges).toHaveLength(2);
  });
});

describe("CA-7 live-shopping ai-description", () => {
  const body = { name: "Gold Chain Tee", selling_points: "heavyweight, limited run" };

  it("fresh charges 100 once, provider once, persists; replay serves the stored description", async () => {
    h.chatPayload = JSON.stringify({ description: "The Gold Chain Tee — heavyweight heat, gone tonight." });
    const r1 = await postJson("/live-shopping/ai-description", body);
    expect(r1.status).toBe(200);
    expect(r1.body.replayed).toBeUndefined();
    expect(r1.body.description).toContain("Gold Chain Tee");
    expect(r1.body.creditsUsed).toBe(100);
    expect(h.charges).toHaveLength(1);
    expect(h.chatCalls).toBe(1);
    const storedRow = [...h.stored.values()][0]!;
    expect(storedRow.rail).toBe("live-shopping-ai-description");
    expect(storedRow.result).toEqual(r1.body);

    const r2 = await postJson("/live-shopping/ai-description", body);
    expect(r2.body).toEqual({ ...r1.body, replayed: true, replayNote: expect.any(String) });
    expect(h.charges).toHaveLength(1);
    expect(h.chatCalls).toBe(1);
  });

  it("provider failure refunds + voids, stores nothing, retry charges fresh", async () => {
    h.chatMode = "throw";
    const r1 = await postJson("/live-shopping/ai-description", body);
    expect(r1.status).toBe(500);
    expect(r1.body.error).toContain("refunded");
    expect(h.refunds).toHaveLength(1);
    expect(h.voids).toHaveLength(1);
    expect(h.stored.size).toBe(0);

    h.chatMode = "ok";
    h.chatPayload = JSON.stringify({ description: "Fresh copy." });
    const r2 = await postJson("/live-shopping/ai-description", body);
    expect(r2.status).toBe(200);
    expect(r2.body.replayed).toBeUndefined();
    expect(h.charges).toHaveLength(2);
  });
});

describe("CA-7 player-upgrades auto-chapters", () => {
  const path = `/showcase-items/${ITEM_ID}/auto-chapters/generate`;

  it("fresh charges 150 once, transcribes once, persists; replay serves the stored chapters", async () => {
    const r1 = await postJson(path, {});
    expect(r1.status).toBe(200);
    expect(r1.body.replayed).toBeUndefined();
    expect(r1.body.autoChapters).toBeTruthy();
    expect(r1.body.creditsRemaining).toBe(10_000 - 150);
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(150);
    expect(h.transcribeCalls).toBe(1);
    const storedRow = [...h.stored.values()][0]!;
    expect(storedRow.rail).toBe("showcase-auto-chapters");
    /* JSON round-trip equality: the durable row holds the body as JSON
       (Date fields serialize to ISO strings over the wire). */
    expect(JSON.parse(JSON.stringify(storedRow.result))).toEqual(r1.body);

    const r2 = await postJson(path, {});
    expect(r2.body).toEqual({ ...r1.body, replayed: true });
    expect(h.charges).toHaveLength(1);
    expect(h.transcribeCalls).toBe(1); // no second transcription
  });

  it("transcription failure refunds + voids, stores nothing, retry charges fresh", async () => {
    h.transcribeMode = "throw";
    const r1 = await postJson(path, {});
    expect(r1.status).toBe(500);
    expect(h.refunds).toHaveLength(1);
    expect(h.voids).toHaveLength(1);
    expect(h.stored.size).toBe(0);

    h.transcribeMode = "ok";
    const r2 = await postJson(path, {});
    expect(r2.status).toBe(200);
    expect(r2.body.replayed).toBeUndefined();
    expect(h.charges).toHaveLength(2);
  });
});
