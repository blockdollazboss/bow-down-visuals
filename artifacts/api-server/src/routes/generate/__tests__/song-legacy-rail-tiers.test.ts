/**
 * Price-accuracy audit #5 (2026-11-02) — the LEGACY song rail
 * (POST /generate-song, routes/generate/song.ts) prices by the SAME
 * duration tiers as the audio rail (POST /generate-music-audio).
 *
 * Before this fix the legacy rail charged a flat 400 VB regardless
 * of the requested length (its own `const CREDIT_COST = 400`),
 * bypassing the ruled tiers in routes/generate/music-audio.ts
 * (400 ≤1 min / 800 ≤3 min / 1,200 ≤5 min / 2,400 ≤10 min) — two
 * price stories for "a song". The rail is REACHABLE today (proven
 * by census, not assumed): routes/index.ts mounts it, the Make
 * Song page posts to it (pages/make-song.tsx) and the World's Song
 * Desk posts to it (components/world/native/CreateDesks.tsx).
 *
 * This suite pins, through the REAL handler with the provider and
 * the credit ledger stubbed at their edges:
 *  1. The charge derives from the audio rail's own tier function —
 *     song.ts imports creditCostForLength from ./music-audio and
 *     keeps NO local flat cost or tier table (source pin).
 *  2. Every length the customer surfaces can actually send prices
 *     at its tier: the default (no length) and "30/60 seconds" at
 *     400, "2 minutes" and "Full song" at 800, an explicit numeric
 *     lengthSeconds at 300s → 1,200 and 301s → 2,400.
 *  3. A member past 10 minutes is refused plainly BEFORE any
 *     charge (the audio rail's song_too_long answer); an admin
 *     caller past the top tier pays exactly the 2,400 top tier.
 *  4. A provider failure refunds the exact TIER amount charged.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";

const MEMBER_EMAIL = "member@example.test";
const ADMIN_EMAIL = "owner@example.test";

const h = vi.hoisted(() => ({
  state: {
    userEmail: "member@example.test",
    charges: [] as Array<{ amount: number; action?: string }>,
    refunds: [] as Array<{ amount: number; action?: string }>,
    history: [] as Array<{ creditsUsed?: number }>,
    providerCalls: 0,
    providerMode: "ok" as "ok" | "throw",
  },
}));

vi.mock("../../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = "11111111-1111-4111-8111-111111111111";
    req.userEmail = h.state.userEmail;
    req.userCredits = 100_000;
    next();
  },
}));

vi.mock("../../../lib/credits", () => ({
  chargeCredits: vi.fn(async (_u: string, amount: number, meta: any) => {
    h.state.charges.push({ amount, action: meta?.action });
    return 100_000 - amount;
  }),
  refundCredits: vi.fn(async (_u: string, amount: number, meta: any) => {
    h.state.refunds.push({ amount, action: meta?.action });
  }),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
  LedgerWriteError: class LedgerWriteError extends Error {},
}));

vi.mock("../../../lib/ai-clients", () => ({
  getOpenAI: () => ({
    chat: {
      completions: {
        create: async () => {
          h.state.providerCalls += 1;
          if (h.state.providerMode === "throw") throw new Error("provider down");
          return { choices: [{ message: { content: "## SONG CONCEPT\nA song." } }] };
        },
      },
    },
  }),
  getTextModel: () => "test-model",
  LOW_REASONING_PARAMS: { reasoning_effort: "low" },
}));

vi.mock("../../../lib/payment-record", () => ({
  recordGenerationHistory: vi.fn(async (row: any) => {
    h.state.history.push({ creditsUsed: row?.creditsUsed });
    return randomUUID();
  }),
  markGenerationHistoryCharged: vi.fn(async () => {}),
}));

vi.mock("../../../lib/retention", () => ({
  recordCreation: vi.fn(async () => {}),
}));

vi.mock("../../../lib/co-stars", () => ({
  buildCoStarContext: vi.fn(async () => ""),
}));

/* The tier function's home (./music-audio) pulls these edges in;
   only its pricing exports are exercised here — the rest are
   stubbed exactly as song-tier-boundaries.test.ts stubs them. */
vi.mock("../../../lib/rail-core", () => ({
  invokeRailHandler: vi.fn(),
}));
vi.mock("../../../lib/voice-swap", () => ({
  swapSongVocalsToVoice: vi.fn(async (buf: Buffer) => buf),
}));
vi.mock("../../../lib/r2-client", () => ({
  r2Upload: vi.fn(async () => {}),
  r2PublicUrl: (key: string) => `https://cdn.example.com/${key}`,
}));
vi.mock("../../../lib/supabase-admin", () => ({
  getSupabaseAdmin: () => {
    throw new Error("no supabase in tests");
  },
}));
vi.mock("@workspace/db", () => ({
  db: { select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn() },
  artistVaultsTable: { id: "id" },
  songsTable: { id: "id" },
}));

import songRouter, {
  creditCostForSongRequest,
  songLengthMsFromLabel,
  songLengthMsForRequest,
} from "../song";
import { SongTooLongError } from "../music-audio";

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.log = { error: () => {}, warn: () => {}, info: () => {} };
    next();
  });
  app.use("/api", songRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  delete process.env["ADMIN_EMAILS"];
  server.closeAllConnections?.();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  h.state.userEmail = MEMBER_EMAIL;
  h.state.charges = [];
  h.state.refunds = [];
  h.state.history = [];
  h.state.providerCalls = 0;
  h.state.providerMode = "ok";
  delete process.env["ADMIN_EMAILS"];
});

async function post(body: Record<string, unknown>) {
  const r = await realFetch(`${baseUrl}/generate-song`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ songTopic: "a test song", ...body }),
  });
  const json = (await r.json().catch(() => null)) as any;
  return { status: r.status, json };
}

describe("source pin — one tier source, imported, never copied", () => {
  const src = readFileSync(new URL("../song.ts", import.meta.url), "utf8");

  it("song.ts imports the tier function from ./music-audio", () => {
    expect(src).toContain("creditCostForLength");
    expect(src).toMatch(/from\s+"\.\/music-audio"/);
  });

  it("song.ts keeps no flat cost and no tier table of its own", () => {
    expect(src).not.toMatch(/const\s+CREDIT_COST\s*=/);
    expect(src).not.toMatch(/export\s+const\s+SONG_PRICE_TIERS\s*=/);
    expect(src).not.toContain("chargeCredits(req.userId!, 400");
  });
});

describe("label parsing — the lengths the customer surfaces send", () => {
  it.each([
    ["30 seconds", 30_000],
    ["60 seconds", 60_000],
    ["2 minutes", 120_000],
    ["Standard (3 min)", 180_000],
    ["Full song", 180_000],
    ["1:30", 90_000],
  ])("%s → %i ms", (label, ms) => {
    expect(songLengthMsFromLabel(label)).toBe(ms);
  });

  it.each(["", "Turbo picks", undefined, null])("%s names no priceable length", (label) => {
    expect(songLengthMsFromLabel(label as any)).toBeNull();
  });

  it("no length at all prices on the 60-second default", () => {
    expect(songLengthMsForRequest({})).toBe(60_000);
    expect(songLengthMsForRequest({ songLength: "" })).toBe(60_000);
  });

  it("an explicit lengthSeconds wins over the label", () => {
    expect(songLengthMsForRequest({ songLength: "30 seconds", lengthSeconds: 300 })).toBe(300_000);
  });
});

describe("the priced tiers — same function, same numbers as the audio rail", () => {
  it.each([
    [{}, 400],
    [{ songLength: "30 seconds" }, 400],
    [{ songLength: "60 seconds" }, 400],
    [{ songLength: "2 minutes" }, 800],
    [{ songLength: "Full song" }, 800],
    [{ lengthSeconds: 180 }, 800],
    [{ lengthSeconds: 300 }, 1_200],
    [{ lengthSeconds: 301 }, 2_400],
    [{ lengthSeconds: 600 }, 2_400],
  ])("%o charges %i VB for a member", (input: any, vb) => {
    expect(creditCostForSongRequest(input, false)).toBe(vb);
  });

  it("a member past 10 minutes throws the audio rail's refusal", () => {
    expect(() => creditCostForSongRequest({ lengthSeconds: 601 }, false)).toThrow(SongTooLongError);
    expect(() => creditCostForSongRequest({ songLength: "12 minutes" }, false)).toThrow(SongTooLongError);
  });

  it("an admin past 10 minutes pays the 2,400 top tier, never a refusal", () => {
    expect(creditCostForSongRequest({ lengthSeconds: 601 }, true)).toBe(2_400);
    expect(creditCostForSongRequest({ songLength: "12 minutes" }, true)).toBe(2_400);
  });
});

describe("route level — POST /generate-song charges the tier", () => {
  it.each([
    [{}, 400],
    [{ songLength: "60 seconds" }, 400],
    [{ songLength: "2 minutes" }, 800],
    [{ songLength: "Full song" }, 800],
    [{ lengthSeconds: 300 }, 1_200],
    [{ lengthSeconds: 301 }, 2_400],
  ])("%o → one charge of %i VB, reported in the response and the history row", async (body: any, vb) => {
    const { status, json } = await post(body);
    expect(status).toBe(200);
    expect(h.state.charges).toEqual([{ amount: vb, action: "Make a Song" }]);
    expect(h.state.refunds).toEqual([]);
    expect(json.creditsUsed).toBe(vb);
    expect(json.creditsRemaining).toBe(100_000 - vb);
    expect(h.state.history).toEqual([{ creditsUsed: vb }]);
  });

  it("a member at 601s is refused plainly BEFORE any charge or provider call", async () => {
    const { status, json } = await post({ lengthSeconds: 601 });
    expect(status).toBe(400);
    expect(json.code).toBe("song_too_long");
    expect(json.error).toMatch(/10 minutes/);
    expect(json.error).toMatch(/Nothing was charged/);
    expect(h.state.charges).toEqual([]);
    expect(h.state.refunds).toEqual([]);
    expect(h.state.providerCalls).toBe(0);
  });

  it("an admin at 601s succeeds at exactly 2,400", async () => {
    process.env["ADMIN_EMAILS"] = ADMIN_EMAIL;
    h.state.userEmail = ADMIN_EMAIL;
    const { status, json } = await post({ lengthSeconds: 601 });
    expect(status).toBe(200);
    expect(h.state.charges).toEqual([{ amount: 2_400, action: "Make a Song" }]);
    expect(json.creditsUsed).toBe(2_400);
  });

  it("the same address with ADMIN_EMAILS unset is refused like any member (fail-closed)", async () => {
    h.state.userEmail = ADMIN_EMAIL;
    const { status, json } = await post({ lengthSeconds: 601 });
    expect(status).toBe(400);
    expect(json.code).toBe("song_too_long");
    expect(h.state.charges).toEqual([]);
  });

  it("a provider failure refunds the exact tier charged (800 for 2 minutes), exactly once", async () => {
    h.state.providerMode = "throw";
    const { status } = await post({ songLength: "2 minutes" });
    expect(status).toBe(500);
    expect(h.state.charges).toEqual([{ amount: 800, action: "Make a Song" }]);
    expect(h.state.refunds).toEqual([{ amount: 800, action: "Make a Song — Refund" }]);
  });
});
