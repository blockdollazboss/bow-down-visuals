/**
 * CA-7 — wave8 family double-charge fixes.
 *
 * Each charged wave8 rail now derives a server-side charge
 * idempotency key (CA-KEY), pre-checks the durable stored-result
 * table (migration 0333) + an in-process cache BEFORE funding, and
 * refunds + VOIDS the key on failure. These tests pin, per rail:
 *
 *   (a) fresh success → 1 charge, 1 work-run, stored row = response
 *       body, NO replayed field;
 *   (b) identical re-POST → 200, body = stored + replayed:true +
 *       replayNote, charges still 1, work-runs still 1 (calendar:
 *       slot delete/insert mutations still 1 set);
 *   (c) provider/work failure → today's error status, refund
 *       recorded, void recorded, NO stored row; retry after failure
 *       charges fresh (charges=2) and succeeds.
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
  providerCalls: 0,
  providerMode: "ok" as "ok" | "throw",
  imageCalls: 0,
  /* calendar slot table state */
  calendarSlots: [] as Array<Record<string, any>>,
  calendarDeletes: 0,
  calendarInsertCalls: 0,
  /* splits sheet table state */
  splitSheets: new Map<string, Record<string, any>>(),
  sheetLoads: 0,
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

vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
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

function payloadFor(argsJson: string): Record<string, unknown> {
  if (argsJson.includes("vocal producer")) {
    return {
      adlibs: [1, 2, 3, 4].map((i) => ({ line: `yeah ${i}`, placement: "bar 4", delivery: "shout it" })),
      stacks: [{ description: "double the hook", voices: "low octave + whispers" }],
      takeA: { style: "anthem", notes: "Big stadium energy throughout." },
      takeB: { style: "whisper", notes: "Close and quiet, reverb forward." },
    };
  }
  if (argsJson.includes("hook surgeon")) {
    return {
      variants: [1, 2, 3, 4, 5].map((i) => ({ hook: `hook ${i}`, angle: "curiosity gap", whyItWorks: "It opens a loop." })),
    };
  }
  if (argsJson.includes("highlight editor")) {
    return {
      moments: [{ startSec: 0, endSec: 10, score: 90, label: "Big play", reason: "Chat exploded." }],
      reelPlan: { totalSec: 10, segments: [{ startSec: 0, endSec: 10, caption: "watch this" }] },
      summary: "A tight reel.",
    };
  }
  if (argsJson.includes("caption editor")) {
    return { cleaned: "hello world again" };
  }
  if (argsJson.includes("booking agent")) {
    return {
      artistName: "Test Artist",
      tagline: "The one to book",
      bio: "A punchy bio that bookers remember.",
      audience: "Fans 18-34 online.",
      rates: [{ tier: "Club Set", price: "$500" }],
      contact: "",
      stats: { genre: "rap", artistType: "solo", visualStyle: "gold", voiceStyle: "smooth" },
    };
  }
  if (argsJson.includes("merch strategist")) {
    return {
      concepts: [1, 2, 3].map((i) => ({
        name: `Drop ${i}`, product: "tee", description: "A wearable design.", pricePoint: "$29", why: "Fans asked for it.",
      })),
      launchPosts: [0, 1, 2, 3, 4].map((d) => ({ dayOffset: d, title: `Day ${d}`, caption: "caption", cta: "Shop now" })),
    };
  }
  if (argsJson.includes("content strategist")) {
    return {
      slots: [0, 1, 2, 3, 4, 5, 6].map((i) => ({
        dayIndex: i, title: `Post ${i}`, postType: "Short video", notes: "Hook first.", bestTime: "18:00",
      })),
    };
  }
  return {};
}

vi.mock("../../lib/ai-clients", () => ({
  getTextModel: () => "test-model",
  LOW_REASONING_PARAMS: { reasoning_effort: "low" },
  getOpenAI: () => ({
    chat: {
      completions: {
        create: async (args: unknown) => {
          h.providerCalls++;
          if (h.providerMode === "throw") throw new Error("provider down");
          return {
            choices: [{ message: { content: JSON.stringify(payloadFor(JSON.stringify(args))) } }],
          };
        },
      },
    },
    images: {
      edit: async () => {
        h.imageCalls++;
        if (h.providerMode === "throw") throw new Error("provider down");
        return { data: [{ b64_json: "aW1hZ2U=" }] };
      },
      generate: async () => {
        h.imageCalls++;
        if (h.providerMode === "throw") throw new Error("provider down");
        return { data: [{ b64_json: "aW1hZ2U=" }] };
      },
    },
  }),
}));

vi.mock("../../lib/objectStorage", () => ({
  uploadMediaToSupabaseStorage: async (objectName: string) => `storage-ref:${objectName}`,
  refreshSupabaseStorageUrl: async (ref: string) => `https://signed.example/${ref}`,
  normalizeToStorageRef: (u: string) => u,
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const genTable = actual.generationStoredResultsTable;
  const calendarTable = actual.wave8CalendarSlotsTable;
  const splitsTable = actual.wave8RoyaltySplitsTable;

  function selectRows(table: unknown, cond: unknown): Array<Record<string, any>> {
    if (table === genTable) {
      const key = keyFromCondition(cond);
      const row = key !== null ? h.stored.get(key) : undefined;
      return row ? [row] : [];
    }
    if (table === splitsTable) {
      h.sheetLoads++;
      const id = keyFromCondition(cond);
      const row = id !== null ? h.splitSheets.get(id) : undefined;
      return row ? [row] : [];
    }
    if (table === calendarTable) {
      return [...h.calendarSlots];
    }
    /* artist vaults + anything else: empty */
    return [];
  }

  function insertRows(table: unknown, v: unknown): Array<Record<string, any>> {
    if (table === calendarTable) {
      h.calendarInsertCalls++;
      const rows = (Array.isArray(v) ? v : [v]) as Array<Record<string, any>>;
      const inserted = rows.map((r, i) => ({ id: `slot-${h.calendarSlots.length + i + 1}`, ...r }));
      h.calendarSlots.push(...inserted);
      return inserted;
    }
    if (table === splitsTable) {
      const row = {
        id: "sheet-created", created_at: new Date(), updated_at: new Date(),
        ...(v as Record<string, any>),
      };
      h.splitSheets.set(row.id, row);
      return [row];
    }
    return [];
  }

  const fakeDb = {
    select: () => {
      let table: unknown;
      let cond: unknown;
      const chain: any = {
        from: (t: unknown) => { table = t; return chain; },
        where: (c: unknown) => { cond = c; return chain; },
        orderBy: () => chain,
        limit: async () => selectRows(table, cond),
        then: (res: any, rej: any) => Promise.resolve(selectRows(table, cond)).then(res, rej),
      };
      return chain;
    },
    insert: (table: unknown) => ({
      values: (v: any) => {
        const obj: any = {
          onConflictDoNothing: async () => {
            if (table === genTable) {
              if (!h.stored.has(v.idempotencyKey)) {
                h.stored.set(v.idempotencyKey, { userId: v.userId, rail: v.rail, result: v.result });
              }
            }
            return [];
          },
          returning: async () => insertRows(table, v),
          then: (res: any, rej: any) => Promise.resolve(insertRows(table, v)).then(res, rej),
        };
        return obj;
      },
    }),
    delete: (table: unknown) => ({
      where: () => {
        const doDelete = () => {
          if (table === calendarTable) {
            h.calendarDeletes++;
            const removed = h.calendarSlots.splice(0);
            return removed.map((r) => ({ id: r.id }));
          }
          if (table === splitsTable) {
            const removed = [...h.splitSheets.values()];
            h.splitSheets.clear();
            return removed.map((r) => ({ id: r.id }));
          }
          return [];
        };
        const obj: any = {
          returning: async () => doDelete(),
          then: (res: any, rej: any) => Promise.resolve(doDelete()).then(res, rej),
        };
        return obj;
      },
    }),
    update: () => ({
      set: () => ({
        where: () => {
          const obj: any = {
            returning: async () => [],
            then: (res: any, rej: any) => Promise.resolve([]).then(res, rej),
          };
          return obj;
        },
      }),
    }),
  };
  return { ...actual, db: fakeDb };
});

import adlibRouter, { __resetWave8AdlibReplayCache } from "../wave8-adlib";
import hookRouter, { __resetWave8HookRewriterReplayCache } from "../wave8-hook-rewriter";
import highlightsRouter, { __resetWave8HighlightsReplayCache } from "../wave8-highlights";
import thumbnailAbRouter, { __resetWave8ThumbnailAbReplayCache } from "../wave8-thumbnail-ab";
import captionRouter, { __resetWave8CaptionStylerReplayCache } from "../wave8-caption-styler";
import mediaKitRouter, { __resetWave8MediaKitReplayCache } from "../wave8-media-kit";
import merchRouter, { __resetWave8MerchDropReplayCache } from "../wave8-merch-drop";
import splitsRouter, { __resetWave8SplitsReplayCache } from "../wave8-splits";
import calendarRouter, { __resetWave8CalendarReplayCache } from "../wave8-calendar";

let base = "";
let server: ReturnType<express.Express["listen"]>;
const realFetch = globalThis.fetch;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(adlibRouter);
  app.use(hookRouter);
  app.use(highlightsRouter);
  app.use(thumbnailAbRouter);
  app.use(captionRouter);
  app.use(mediaKitRouter);
  app.use(merchRouter);
  app.use(splitsRouter);
  app.use(calendarRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await new Promise((r) => server.close(r));
});

beforeEach(() => {
  __resetWave8AdlibReplayCache();
  __resetWave8HookRewriterReplayCache();
  __resetWave8HighlightsReplayCache();
  __resetWave8ThumbnailAbReplayCache();
  __resetWave8CaptionStylerReplayCache();
  __resetWave8MediaKitReplayCache();
  __resetWave8MerchDropReplayCache();
  __resetWave8SplitsReplayCache();
  __resetWave8CalendarReplayCache();
  h.balance = 100_000;
  h.charges = []; h.refunds = []; h.voids = [];
  h.chargedKeys = new Set();
  h.stored = new Map();
  h.providerCalls = 0; h.providerMode = "ok";
  h.imageCalls = 0;
  h.calendarSlots = []; h.calendarDeletes = 0; h.calendarInsertCalls = 0;
  h.splitSheets = new Map(); h.sheetLoads = 0;
  /* thumbnail-ab downloads its source image through the global fetch */
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    headers: { get: () => "image/png" },
    arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer,
  })));
});

async function post(path: string, body?: unknown) {
  const res = await realFetch(`${base}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => null)) as Record<string, any> | null };
}

function expectReplay(a: any, b: any, note: string) {
  expect(b.status).toBe(200);
  expect(b.json).toEqual({ ...a.json, replayed: true, replayNote: note });
}

describe("wave8-adlib", () => {
  const body = { lyrics: "la la", songTitle: "Song", energy: "hype" };
  const NOTE = "These are the ad-libs you already made for this request — tweak the words for a fresh set.";

  it("fresh → replay → failure/retry", async () => {
    const a = await post("/wave8/adlib/generate", body);
    expect(a.status).toBe(200);
    expect(a.json?.["replayed"]).toBeUndefined();
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(150);
    expect(h.providerCalls).toBe(1);
    expect(h.stored.size).toBe(1);
    expect([...h.stored.values()][0]!.result).toEqual(a.json);
    expect([...h.stored.values()][0]!.rail).toBe("wave8-adlib");

    const b = await post("/wave8/adlib/generate", body);
    expectReplay(a, b, NOTE);
    expect(h.charges).toHaveLength(1);
    expect(h.providerCalls).toBe(1);
  });

  it("failure refunds + voids, stores nothing; retry charges fresh", async () => {
    h.providerMode = "throw";
    const failed = await post("/wave8/adlib/generate", { lyrics: "other song" });
    expect(failed.status).toBe(500);
    expect(failed.json?.["refunded"]).toBe(true);
    expect(h.refunds).toEqual([150]);
    expect(h.voids).toHaveLength(1);
    expect(h.stored.size).toBe(0);

    h.providerMode = "ok";
    const retry = await post("/wave8/adlib/generate", { lyrics: "other song" });
    expect(retry.status).toBe(200);
    expect(h.charges).toHaveLength(2);
  });
});

describe("wave8-hook-rewriter", () => {
  const body = { post: "my old post", niche: "fitness" };
  const NOTE = "These are the hook rewrites you already made for this request — tweak the post for a fresh set.";

  it("fresh → replay → failure/retry", async () => {
    const a = await post("/wave8/hook-rewriter/rewrite", body);
    expect(a.status).toBe(200);
    expect(a.json?.["replayed"]).toBeUndefined();
    expect(a.json?.["variants"]).toHaveLength(5);
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(50);
    expect(h.providerCalls).toBe(1);
    expect(h.stored.size).toBe(1);
    expect([...h.stored.values()][0]!.result).toEqual(a.json);

    const b = await post("/wave8/hook-rewriter/rewrite", body);
    expectReplay(a, b, NOTE);
    expect(h.charges).toHaveLength(1);
    expect(h.providerCalls).toBe(1);
  });

  it("failure refunds + voids, stores nothing; retry charges fresh", async () => {
    h.providerMode = "throw";
    const failed = await post("/wave8/hook-rewriter/rewrite", { post: "another post" });
    expect(failed.status).toBe(502);
    expect(h.refunds).toEqual([50]);
    expect(h.voids).toHaveLength(1);
    expect(h.stored.size).toBe(0);

    h.providerMode = "ok";
    const retry = await post("/wave8/hook-rewriter/rewrite", { post: "another post" });
    expect(retry.status).toBe(200);
    expect(h.charges).toHaveLength(2);
  });
});

describe("wave8-highlights", () => {
  const body = { chatLog: "12:00 POG", targetSeconds: 60 };
  const NOTE = "This is the highlight plan you already made for this request — tweak the source material for a fresh one.";

  it("fresh → replay → failure/retry", async () => {
    const a = await post("/wave8/highlights/cut", body);
    expect(a.status).toBe(200);
    expect(a.json?.["replayed"]).toBeUndefined();
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(300);
    expect(h.providerCalls).toBe(1);
    expect(h.stored.size).toBe(1);
    expect([...h.stored.values()][0]!.result).toEqual(a.json);

    const b = await post("/wave8/highlights/cut", body);
    expectReplay(a, b, NOTE);
    expect(h.charges).toHaveLength(1);
    expect(h.providerCalls).toBe(1);
  });

  it("failure refunds + voids, stores nothing; retry charges fresh", async () => {
    h.providerMode = "throw";
    const failed = await post("/wave8/highlights/cut", { transcript: "hello stream" });
    expect(failed.status).toBe(500);
    expect(failed.json?.["refunded"]).toBe(true);
    expect(h.refunds).toEqual([300]);
    expect(h.voids).toHaveLength(1);
    expect(h.stored.size).toBe(0);

    h.providerMode = "ok";
    const retry = await post("/wave8/highlights/cut", { transcript: "hello stream" });
    expect(retry.status).toBe(200);
    expect(h.charges).toHaveLength(2);
  });
});

describe("wave8-thumbnail-ab", () => {
  const body = { sourceImageUrl: "https://example.com/thumb.png", title: "My Video", niche: "gaming" };
  const NOTE = "These are the thumbnail variants you already made for this request — tweak the title or source for a fresh pair.";

  it("fresh → replay → failure/retry", async () => {
    const a = await post("/wave8/thumbnail-ab/variants", body);
    expect(a.status).toBe(200);
    expect(a.json?.["replayed"]).toBeUndefined();
    expect(a.json?.["variants"]).toHaveLength(2);
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(75);
    expect(h.imageCalls).toBe(2);
    expect(h.stored.size).toBe(1);
    expect([...h.stored.values()][0]!.result).toEqual(a.json);

    const b = await post("/wave8/thumbnail-ab/variants", body);
    expectReplay(a, b, NOTE);
    expect(h.charges).toHaveLength(1);
    expect(h.imageCalls).toBe(2);
  });

  it("failure refunds + voids, stores nothing; retry charges fresh", async () => {
    h.providerMode = "throw";
    const failed = await post("/wave8/thumbnail-ab/variants", { sourceImageUrl: "https://example.com/other.png" });
    expect(failed.status).toBe(500);
    expect(failed.json?.["error"]).toBe("generation_failed");
    expect(h.refunds).toEqual([75]);
    expect(h.voids).toHaveLength(1);
    expect(h.stored.size).toBe(0);

    h.providerMode = "ok";
    const retry = await post("/wave8/thumbnail-ab/variants", { sourceImageUrl: "https://example.com/other.png" });
    expect(retry.status).toBe(200);
    expect(h.charges).toHaveLength(2);
  });
});

describe("wave8-caption-styler", () => {
  const body = { transcript: "hello world again", preset: "karaoke" };
  const NOTE = "These are the styled captions you already made for this request — tweak the transcript or preset for a fresh set.";

  it("fresh → replay → failure/retry", async () => {
    const a = await post("/wave8/caption-styler/burn", body);
    expect(a.status).toBe(200);
    expect(a.json?.["replayed"]).toBeUndefined();
    expect(a.json?.["words"]).toHaveLength(3);
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(100);
    expect(h.providerCalls).toBe(1);
    expect(h.stored.size).toBe(1);
    expect([...h.stored.values()][0]!.result).toEqual(a.json);

    const b = await post("/wave8/caption-styler/burn", body);
    expectReplay(a, b, NOTE);
    expect(h.charges).toHaveLength(1);
    expect(h.providerCalls).toBe(1);
  });

  it("failure refunds + voids, stores nothing; retry charges fresh", async () => {
    h.providerMode = "throw";
    const failed = await post("/wave8/caption-styler/burn", { transcript: "different words here", preset: "popin" });
    expect(failed.status).toBe(500);
    expect(failed.json?.["error"]).toBe("generation_failed");
    expect(h.refunds).toEqual([100]);
    expect(h.voids).toHaveLength(1);
    expect(h.stored.size).toBe(0);

    h.providerMode = "ok";
    const retry = await post("/wave8/caption-styler/burn", { transcript: "different words here", preset: "popin" });
    expect(retry.status).toBe(200);
    expect(h.charges).toHaveLength(2);
  });
});

describe("wave8-media-kit", () => {
  const body = {};
  const NOTE = "This is the media kit you already made for this request — pick a different vault for a fresh one.";

  it("fresh → replay → failure/retry", async () => {
    const a = await post("/wave8/media-kit/generate", body);
    expect(a.status).toBe(200);
    expect(a.json?.["replayed"]).toBeUndefined();
    expect(a.json?.["kit"]?.bio).toBeTruthy();
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(100);
    expect(h.providerCalls).toBe(1);
    expect(h.stored.size).toBe(1);
    expect([...h.stored.values()][0]!.result).toEqual(a.json);

    const b = await post("/wave8/media-kit/generate", body);
    expectReplay(a, b, NOTE);
    expect(h.charges).toHaveLength(1);
    expect(h.providerCalls).toBe(1);
  });

  it("failure refunds + voids, stores nothing; retry charges fresh", async () => {
    h.providerMode = "throw";
    const failed = await post("/wave8/media-kit/generate", body);
    expect(failed.status).toBe(502);
    expect(failed.json?.["error"]).toBe("generation_failed");
    expect(h.refunds).toEqual([100]);
    expect(h.voids).toHaveLength(1);
    expect(h.stored.size).toBe(0);

    h.providerMode = "ok";
    const retry = await post("/wave8/media-kit/generate", body);
    expect(retry.status).toBe(200);
    expect(h.charges).toHaveLength(2);
  });
});

describe("wave8-merch-drop", () => {
  const body = { niche: "gaming", audience: "fans", priceBand: "mid" };
  const NOTE = "This is the merch drop plan you already made for this request — tweak the niche or price band for a fresh one.";

  it("fresh → replay → failure/retry", async () => {
    const a = await post("/wave8/merch-drop/plan", body);
    expect(a.status).toBe(200);
    expect(a.json?.["replayed"]).toBeUndefined();
    expect(a.json?.["plan"]?.concepts).toHaveLength(3);
    expect(a.json?.["plan"]?.launchPosts).toHaveLength(5);
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(100);
    expect(h.providerCalls).toBe(1);
    expect(h.stored.size).toBe(1);
    expect([...h.stored.values()][0]!.result).toEqual(a.json);

    const b = await post("/wave8/merch-drop/plan", body);
    expectReplay(a, b, NOTE);
    expect(h.charges).toHaveLength(1);
    expect(h.providerCalls).toBe(1);
  });

  it("failure refunds + voids, stores nothing; retry charges fresh", async () => {
    h.providerMode = "throw";
    const failed = await post("/wave8/merch-drop/plan", { niche: "cooking", priceBand: "budget" });
    expect(failed.status).toBe(502);
    expect(h.refunds).toEqual([100]);
    expect(h.voids).toHaveLength(1);
    expect(h.stored.size).toBe(0);

    h.providerMode = "ok";
    const retry = await post("/wave8/merch-drop/plan", { niche: "cooking", priceBand: "budget" });
    expect(retry.status).toBe(200);
    expect(h.charges).toHaveLength(2);
  });
});

describe("wave8-splits pdf", () => {
  const NOTE = "This is the split sheet you already finalized for this request — it has not been charged again.";
  const sheetRow = {
    id: "sheet-1",
    user_id: USER,
    song_title: "My Song",
    collaborators: [
      { name: "A", role: "", pct: 50 },
      { name: "B", role: "", pct: 50 },
    ],
    created_at: new Date(),
    updated_at: new Date(),
  };

  it("fresh → replay (no sheet re-load) → failure/retry", async () => {
    h.splitSheets.set("sheet-1", { ...sheetRow });
    const a = await post("/wave8/splits/pdf", { splitId: "sheet-1" });
    expect(a.status).toBe(200);
    expect(a.json?.["replayed"]).toBeUndefined();
    expect(a.json?.["songTitle"]).toBe("My Song");
    expect(a.json?.["totalPct"]).toBe(100);
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(50);
    expect(h.sheetLoads).toBe(1);
    expect(h.stored.size).toBe(1);
    expect([...h.stored.values()][0]!.result).toEqual(a.json);

    const b = await post("/wave8/splits/pdf", { splitId: "sheet-1" });
    expectReplay(a, b, NOTE);
    expect(h.charges).toHaveLength(1);
    expect(h.sheetLoads).toBe(1);
  });

  it("missing sheet → 404 + refund + void, no stored row; retry charges fresh once the sheet exists", async () => {
    const failed = await post("/wave8/splits/pdf", { splitId: "sheet-9" });
    expect(failed.status).toBe(404);
    expect(failed.json?.["error"]).toBe("Split sheet not found.");
    expect(h.refunds).toEqual([50]);
    expect(h.voids).toHaveLength(1);
    expect(h.stored.size).toBe(0);

    h.splitSheets.set("sheet-9", { ...sheetRow, id: "sheet-9" });
    const retry = await post("/wave8/splits/pdf", { splitId: "sheet-9" });
    expect(retry.status).toBe(200);
    expect(h.charges).toHaveLength(2);
  });
});

describe("wave8-calendar autofill (Pattern C)", () => {
  const body = { weekStart: "2026-11-09", pillars: ["music", "behind the scenes"] };
  const NOTE = "This is the content week you already made for this request — tweak the pillars for a fresh one.";

  it("fresh → replay does NOT delete/reinsert → failure/retry", async () => {
    const a = await post("/wave8/calendar/autofill", body);
    expect(a.status).toBe(200);
    expect(a.json?.["replayed"]).toBeUndefined();
    expect(a.json?.["slots"]).toHaveLength(7);
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(150);
    expect(h.providerCalls).toBe(1);
    expect(h.calendarDeletes).toBe(1);
    expect(h.calendarInsertCalls).toBe(1);
    expect(h.calendarSlots).toHaveLength(7);
    expect(h.stored.size).toBe(1);
    expect([...h.stored.values()][0]!.result).toEqual(a.json);

    const b = await post("/wave8/calendar/autofill", body);
    expectReplay(a, b, NOTE);
    expect(h.charges).toHaveLength(1);
    expect(h.providerCalls).toBe(1);
    /* Pattern C: the replay must not re-run the week's delete+reinsert. */
    expect(h.calendarDeletes).toBe(1);
    expect(h.calendarInsertCalls).toBe(1);
    expect(h.calendarSlots).toHaveLength(7);
  });

  it("failure refunds + voids, stores nothing, no slot mutations; retry charges fresh", async () => {
    h.providerMode = "throw";
    const failed = await post("/wave8/calendar/autofill", { weekStart: "2026-11-16", pillars: ["music"] });
    expect(failed.status).toBe(502);
    expect(h.refunds).toEqual([150]);
    expect(h.voids).toHaveLength(1);
    expect(h.stored.size).toBe(0);
    expect(h.calendarDeletes).toBe(0);
    expect(h.calendarInsertCalls).toBe(0);

    h.providerMode = "ok";
    const retry = await post("/wave8/calendar/autofill", { weekStart: "2026-11-16", pillars: ["music"] });
    expect(retry.status).toBe(200);
    expect(h.charges).toHaveLength(2);
    expect(h.calendarDeletes).toBe(1);
    expect(h.calendarInsertCalls).toBe(1);
  });
});
