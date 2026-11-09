/**
 * Gate #5 pre-proof — SONG DURATION TIERS + >10MIN MEMBER REFUSAL.
 *
 * The recorded rulings (owner, Oct 2026; MEMORY.md): songs are
 * duration-tiered 400 VB (≤1 min) / 800 (≤3 min) / 1,200 (≤5 min) /
 * 2,400 (≤10 min); a song over 10 minutes is REFUSED up front for
 * regular members — plain words, BEFORE any charge — and admins
 * (fail-closed ADMIN_EMAILS allowlist) are exempt: allowed, charged
 * at the 2,400 top tier, length passed to the provider untrimmed.
 *
 * What the suite already proved before this file (census, Nov 1):
 *  - routes/generate/__tests__/song-tier-boundaries.test.ts pins the
 *    PURE pricing function (creditCostForLength) at every boundary
 *    second + millisecond edge, and one route-level member refusal
 *    (601s → 400, chargeCredits mock never called).
 *  - routes/__tests__/music-audio-library-linkage.test.ts pins the
 *    route at 700s: member refused before provider/charge; admin
 *    succeeds untrimmed at 2,400; ADMIN_EMAILS unset fails closed;
 *    admin at 180s pays the normal 800 tier.
 *  - lib/__tests__/operator-song-parity.test.ts pins the same rule
 *    through the operator's Tier-3 song tools.
 *
 * What was NOT proven anywhere — the gaps this file closes, all
 * through the REAL POST /generate-music-audio handler with a
 * balance-tracking ledger (the provider is stubbed at fetch, the
 * exact pattern the linkage suite uses; no real provider is called):
 *  1. Every tier boundary charges EXACTLY its tier through the route
 *     — the ledger entry, the balance decrement, the creditsRemaining
 *     the caller sees, and the length the provider is asked for.
 *  2. A >10min member refusal leaves the member's balance
 *     BYTE-IDENTICAL: no charge, no refund (no reservation left
 *     dangling and then "fixed"), no provider call, no library row.
 *     This is the proof that refusal happens BEFORE charge in code
 *     order — asserted on state, not read off the source.
 *  3. The admin exemption at the boundary itself: 601s — one second
 *     over — succeeds for an admin at exactly 2,400, untrimmed.
 *
 * The code's own duration unit is milliseconds: the body carries
 * lengthSeconds (a number), the handler converts with
 * Math.round(seconds × 1000), clamps members to [10s, 600s], and
 * prices on the millisecond tiers in SONG_PRICE_TIERS. Fractional
 * seconds therefore cross tiers at the millisecond edge — pinned
 * below at 60.5s (→ 800) for a member and 600.5s (→ refusal).
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

const MEMBER = "11111111-1111-4111-8111-111111111111";
const MEMBER_EMAIL = "member@example.test";
const ADMIN_EMAIL = "owner@example.test";
const SEED_BALANCE = 100_000;

const h = vi.hoisted(() => ({
  state: {
    userEmail: "",
    /* The ledger: chargeCredits deducts, refundCredits restores.
       balance is the member's money — the refusal tests assert it
       bit-for-bit. */
    balance: 0,
    charges: [] as Array<{ userId: string; cost: number }>,
    refunds: [] as Array<{ userId: string; amount: number }>,
    songs: [] as Array<Record<string, unknown>>,
    elevenCalls: 0,
    lastMusicLengthMs: null as number | null,
  },
}));

const dialect = new PgDialect();
function renderParams(cond: unknown): unknown[] {
  return dialect.sqlToQuery(cond as never).params as unknown[];
}

vi.mock("../../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = MEMBER;
    req.userEmail = h.state.userEmail;
    /* requireAuth snapshots the balance at auth time; mirror the
       ledger so the handler's affordability pre-check sees the
       member's real balance. */
    req.userCredits = h.state.balance;
    next();
  },
}));

vi.mock("../../../lib/credits", () => ({
  chargeCredits: vi.fn(async (userId: string, cost: number) => {
    if (cost > h.state.balance) {
      throw new (class OutOfCreditsError extends Error {})();
    }
    h.state.balance -= cost;
    h.state.charges.push({ userId, cost });
    return h.state.balance;
  }),
  buildChargeIdempotencyKey: (scope: string, userId: string, clientKey: unknown, intent: unknown) => {
    const ck = typeof clientKey === "string" && clientKey.trim().length >= 8 ? clientKey.trim() : null;
    return ck ? `${scope}:${userId}:client:${ck}` : `${scope}:${userId}:${JSON.stringify(intent ?? {})}`;
  },
  voidChargeIdempotencyKey: async () => {},
  refundCredits: vi.fn(async (userId: string, amount: number) => {
    h.state.balance += amount;
    h.state.refunds.push({ userId, amount });
  }),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
  LedgerWriteError: class LedgerWriteError extends Error {},
}));

vi.mock("../../../lib/payment-record", () => ({
  recordGenerationHistory: vi.fn(async () => randomUUID()),
  markGenerationHistoryCharged: vi.fn(async () => {}),
}));

vi.mock("../../../lib/r2-client", () => ({
  r2Upload: vi.fn(async () => {}),
  r2PublicUrl: (key: string) => `https://cdn.example.com/${key}`,
}));

vi.mock("../../../lib/voice-swap", () => ({
  swapSongVocalsToVoice: vi.fn(async (buf: Buffer) => buf),
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const state = h.state;
  const { songsTable, artistVaultsTable } = actual;

  const fakeDb: any = {
    select: (fields?: unknown) => ({
      from: (table: unknown) => ({
        where: (cond: unknown) => {
          const params = renderParams(cond);
          const rows = () => {
            if (table === artistVaultsTable) return [];
            if (table === songsTable) {
              const fieldKeys =
                fields && typeof fields === "object"
                  ? Object.keys(fields as Record<string, unknown>)
                  : [];
              if (fieldKeys.length === 1 && fieldKeys[0] === "id") {
                /* The library-save existence check: (user_id, audio_path). */
                return state.songs.filter(
                  (s) => s["user_id"] === params[0] && s["audio_path"] === params[1],
                );
              }
              return state.songs.filter((s) => s["user_id"] === params[0]);
            }
            return [];
          };
          return {
            limit: async (n: number) => rows().slice(0, n),
            then: (res: any, rej: any) => Promise.resolve(rows()).then(res, rej),
          };
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: (obj: Record<string, unknown>) => ({
        returning: async () => {
          if (table !== songsTable) throw new Error("unexpected insert table");
          const row: Record<string, unknown> = {
            id: randomUUID(),
            parent_song_id: null,
            mashup_sources: null,
            mashup_style: null,
            created_at: new Date(),
            ...obj,
          };
          state.songs.push(row);
          return [row];
        },
      }),
    }),
  };

  return { ...actual, db: fakeDb };
});

import musicAudioRouter from "../music-audio";

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

beforeAll(async () => {
  process.env["ELEVENLABS_API_KEY"] = "test-key-not-real";
  /* The provider edge: stubbed at global fetch, the linkage suite's
     pattern. Records the exact music_length_ms the handler asked
     for and returns dummy audio bytes — no real provider call. */
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: { body?: unknown }) => {
      if (String(url).includes("api.elevenlabs.io")) {
        h.state.elevenCalls += 1;
        try {
          const parsed = JSON.parse(String(init?.body ?? "{}")) as {
            music_length_ms?: number;
          };
          h.state.lastMusicLengthMs = parsed.music_length_ms ?? null;
        } catch {
          h.state.lastMusicLengthMs = null;
        }
        const buf = Buffer.from("fake-audio-bytes");
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () =>
            buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
          text: async () => "",
        };
      }
      throw new Error(`unexpected fetch in test: ${String(url)}`);
    }),
  );

  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.log = { error: () => {}, warn: () => {}, info: () => {} };
    next();
  });
  app.use("/api", musicAudioRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  vi.unstubAllGlobals();
  delete process.env["ELEVENLABS_API_KEY"];
  delete process.env["ADMIN_EMAILS"];
  server.closeAllConnections?.();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  h.state.userEmail = MEMBER_EMAIL;
  h.state.balance = SEED_BALANCE;
  h.state.charges = [];
  h.state.refunds = [];
  h.state.songs = [];
  h.state.elevenCalls = 0;
  h.state.lastMusicLengthMs = null;
  delete process.env["ADMIN_EMAILS"];
});

async function generate(lengthSeconds: number) {
  const r = await realFetch(`${baseUrl}/generate-music-audio`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: "a royal anthem", lengthSeconds }),
  });
  const json = (await r.json().catch(() => null)) as any;
  return { status: r.status, json };
}

describe("proof 1 — every tier boundary charges exactly its tier through the route", () => {
  it.each([
    // [lengthSeconds, expectedVb] — both sides of every boundary,
    // in the code's own unit (seconds in the body, priced on ms).
    [30, 400], // mid ≤1 min tier
    [60, 400], // exactly ≤1 min: still 400
    [61, 800], // first second of the ≤3 min tier
    [180, 800], // exactly ≤3 min: still 800
    [181, 1200], // first second of the ≤5 min tier
    [300, 1200], // exactly ≤5 min: still 1,200
    [301, 2400], // first second of the ≤10 min tier
    [599, 2400],
    [600, 2400], // exactly ≤10 min: still 2,400 — the last legal member length
  ])("%is charges exactly %i VB", async (seconds, vb) => {
    const { status, json } = await generate(seconds);
    expect(status).toBe(200);
    /* The ledger took exactly the tier price, once, from this member. */
    expect(h.state.charges).toEqual([{ userId: MEMBER, cost: vb }]);
    expect(h.state.refunds).toEqual([]);
    expect(h.state.balance).toBe(SEED_BALANCE - vb);
    /* The caller sees the same post-charge balance the ledger holds. */
    expect(json.creditsRemaining).toBe(SEED_BALANCE - vb);
    /* The provider was asked for exactly the requested length. */
    expect(h.state.elevenCalls).toBe(1);
    expect(h.state.lastMusicLengthMs).toBe(seconds * 1000);
    expect(json.durationMs).toBe(seconds * 1000);
  });

  it("the millisecond edge crosses tiers: 60.5s prices at the ≤3 min tier (800)", async () => {
    const { status } = await generate(60.5);
    expect(status).toBe(200);
    expect(h.state.charges).toEqual([{ userId: MEMBER, cost: 800 }]);
    expect(h.state.lastMusicLengthMs).toBe(60_500);
    expect(h.state.balance).toBe(SEED_BALANCE - 800);
  });
});

describe("proof 2 — a >10min member request is refused BEFORE any charge (balance byte-identical)", () => {
  it.each([601, 900, 3600])(
    "%is: plain-words 400, balance untouched, no charge / refund / provider call / library row",
    async (seconds) => {
      const balanceBefore = h.state.balance;
      const { status, json } = await generate(seconds);
      expect(status).toBe(400);
      expect(json.code).toBe("song_too_long");
      /* Plain words a member can act on: names the limit and says
         nothing was charged; no internals leak into the sentence. */
      expect(json.error).toMatch(/10 minutes/);
      expect(json.error).toMatch(/Nothing was charged/);
      expect(json.error).not.toMatch(/SONG_PRICE_TIERS|creditCostForLength|SongTooLong|undefined|NaN/);
      /* The money proof: the balance is byte-identical and the
         ledger never moved — no charge, and no refund either (a
         refund would mean a reservation WAS taken and released:
         the dangling-reservation failure this leg exists to rule
         out). */
      expect(h.state.balance).toBe(balanceBefore);
      expect(h.state.charges).toEqual([]);
      expect(h.state.refunds).toEqual([]);
      /* And nothing downstream of the charge moved either. */
      expect(h.state.elevenCalls).toBe(0);
      expect(h.state.songs).toEqual([]);
    },
  );

  it("600.5s — half a second over, in the code's millisecond unit — already refuses, balance untouched", async () => {
    const { status, json } = await generate(600.5);
    expect(status).toBe(400);
    expect(json.code).toBe("song_too_long");
    expect(h.state.balance).toBe(SEED_BALANCE);
    expect(h.state.charges).toEqual([]);
    expect(h.state.refunds).toEqual([]);
    expect(h.state.elevenCalls).toBe(0);
  });
});

describe("proof 3 — the admin exemption at the boundary: >10min succeeds at exactly 2,400, untrimmed", () => {
  beforeEach(() => {
    process.env["ADMIN_EMAILS"] = ADMIN_EMAIL;
    h.state.userEmail = ADMIN_EMAIL;
  });

  it.each([601, 700])(
    "admin at %is: 200, one charge of exactly 2,400, provider asked for the full untrimmed length",
    async (seconds) => {
      const { status, json } = await generate(seconds);
      expect(status).toBe(200);
      expect(h.state.charges).toEqual([{ userId: MEMBER, cost: 2400 }]);
      expect(h.state.refunds).toEqual([]);
      expect(h.state.balance).toBe(SEED_BALANCE - 2400);
      expect(json.creditsRemaining).toBe(SEED_BALANCE - 2400);
      /* Never clamped to the 600s ceiling for an admin. */
      expect(h.state.lastMusicLengthMs).toBe(seconds * 1000);
      expect(json.durationMs).toBe(seconds * 1000);
      const [row] = h.state.songs;
      expect(String(row!["duration_sec"])).toBe(String(seconds));
    },
  );

  it("the same address with ADMIN_EMAILS unset is refused like any member (fail-closed at the boundary)", async () => {
    delete process.env["ADMIN_EMAILS"];
    const { status, json } = await generate(601);
    expect(status).toBe(400);
    expect(json.code).toBe("song_too_long");
    expect(h.state.balance).toBe(SEED_BALANCE);
    expect(h.state.charges).toEqual([]);
    expect(h.state.elevenCalls).toBe(0);
  });
});
